'use client';

import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { c } from './ansi';
import { baseDefinition, STATIC_SERVER_PATH, STATIC_SERVER_JS } from './baseImages';
import { contextFiles, resolveCopySources } from './context';
import { classifyBase, parseDockerfile, splitRunCommand, stripFlags, toCommandArray } from './dockerfile';
import { formatBytes } from './format';
import { byteLength, randomHex, sha256, shortId } from './hash';
import { dirname, isInside, join, projectPath, toAbs } from './paths';
import { expandVars, isSimpleCommand, parseKeyValues, splitArgs } from './shellwords';
import { KEYS, load, remove as removeKey, save } from './storage';
import { Store } from './store';
import type { BaseFlavor, Container, Image, ImageConfig, Layer, LogEntry, Out, PortMapping } from './types';

/* ------------------------------------------------------------------ */
/* Stav                                                                */
/* ------------------------------------------------------------------ */

export const dockerStore = new Store<{ images: Image[]; containers: Container[] }>({
  images: [],
  containers: [],
});

interface LayerRecord {
  createdBy: string;
  size: number;
  fs: boolean;
  /** Velikost binárního snapshotu (jen u vrstev, které mění FS). */
  snapshotSize?: number;
  created: number;
}

export interface BuildOptions {
  tag?: string;
  /** Složka kontextu relativně k projektu ('' = kořen). */
  contextDir: string;
  /** Cesta k Dockerfile relativně k projektu. */
  dockerfile: string;
  files: Record<string, string>;
  buildArgs?: Record<string, string>;
  noCache?: boolean;
  out: Out;
  signal?: AbortSignal;
  cols?: number;
}

export interface CreateOptions {
  image: Image;
  /** Reference tak, jak ji uživatel napsal (zobrazí se v `docker ps`). */
  imageRef?: string;
  name?: string;
  ports?: PortMapping[];
  env?: Record<string, string>;
  cmd?: string[];
  entrypoint?: string[];
  workdir?: string;
  autoRemove?: boolean;
  compose?: Container['compose'];
  openOnReady?: boolean;
}

type LogListener = (entry: LogEntry) => void;
type ExitListener = (c: Container) => void;
type OpenListener = (url: string, container: Container | null) => void;

const ROOT_BUILDS = 'builds';
const ROOT_CONTAINERS = 'containers';
const MAX_LOG_LINES = 3000;

const ADJECTIVES = ['admiring', 'brave', 'clever', 'dazzling', 'eager', 'festive', 'gallant', 'happy', 'jolly', 'keen', 'lucid', 'modest', 'nifty', 'quirky', 'relaxed', 'sharp', 'tender', 'upbeat', 'vibrant', 'zealous'];
const NAMES = ['babbage', 'curie', 'darwin', 'einstein', 'feynman', 'goodall', 'hopper', 'heyrovsky', 'kepler', 'lovelace', 'mendel', 'newton', 'noether', 'pasteur', 'ritchie', 'tesla', 'turing', 'wichterle', 'wozniak', 'yonath'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalizace reference image: `app` → `app:latest`. */
export function normalizeRef(ref: string): string {
  const lastSlash = ref.lastIndexOf('/');
  return ref.lastIndexOf(':') > lastSlash ? ref : `${ref}:latest`;
}

/** Docker zobrazuje COMMAND zkráceně a v uvozovkách. */
export function displayCommand(cmd: string[]): string {
  return cmd.join(' ');
}

class BuildError extends Error {}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

class DockerEngine {
  wc: WebContainer | null = null;
  readonly ready: Promise<WebContainer>;
  private resolveReady!: (wc: WebContainer) => void;
  private rejectReady!: (e: unknown) => void;

  private procs = new Map<string, { proc: WebContainerProcess; killed: boolean; done: Promise<void> }>();
  private logs = new Map<string, LogEntry[]>();
  private partial = new Map<string, string>();
  private logListeners = new Map<string, Set<LogListener>>();
  private exitListeners = new Set<ExitListener>();
  private openListeners = new Set<OpenListener>();
  private layers: Record<string, LayerRecord> = {};
  /** Porty otevřené procesy mimo kontejnery (např. `node server.js` spuštěné z jsh). */
  private foreignPorts = new Set<number>();
  private loaded = false;
  private saveContainersTimer: ReturnType<typeof setTimeout> | null = null;
  private saveLogsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.ready = new Promise<WebContainer>((res, rej) => {
      this.resolveReady = res;
      this.rejectReady = rej;
    });
    // Neodchycené odmítnutí (boot selhal) nechceme v konzoli jako unhandled.
    this.ready.catch(() => undefined);
  }

  get images(): Image[] {
    return dockerStore.get().images;
  }
  get containers(): Container[] {
    return dockerStore.get().containers;
  }

  /* ---------------- životní cyklus ---------------- */

  async loadState(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const [images, containers, layers, logs] = await Promise.all([
      load<Image[]>(KEYS.images),
      load<Container[]>(KEYS.containers),
      load<Record<string, LayerRecord>>(KEYS.layers),
      load<Record<string, LogEntry[]>>('logs'),
    ]);
    this.layers = layers ?? {};
    for (const [id, entries] of Object.entries(logs ?? {})) this.logs.set(id, entries);
    const restored = (containers ?? []).map((ct) => {
      if (ct.status !== 'running') return { ...ct, url: null, internalPort: null };
      this.pushLog(ct.id, c.gray('[minidocker] kontejner byl ukončen obnovením stránky'));
      return { ...ct, status: 'exited' as const, exitCode: 137, finishedAt: Date.now(), url: null, internalPort: null };
    });
    dockerStore.set({ images: images ?? [], containers: restored });
  }

  attach(wc: WebContainer): void {
    if (this.wc === wc) return;
    this.wc = wc;
    wc.on('port', (port, type, url) => {
      const ct = this.containerForPort(port, type === 'open');
      if (type === 'close') this.foreignPorts.delete(port);
      if (!ct) {
        if (type === 'open') this.foreignPorts.add(port);
        return;
      }
      if (type === 'open') this.patchContainer(ct.id, { url, internalPort: port });
      else this.patchContainer(ct.id, { url: null });
    });
    wc.on('server-ready', (port, url) => {
      const ct = this.containerForPort(port, true);
      if (ct) {
        this.patchContainer(ct.id, { url, internalPort: port });
        if (ct.openOnReady) this.openListeners.forEach((l) => l(url, ct));
      } else {
        // Server spuštěný přímo ze shellu (ne z kontejneru)
        this.openListeners.forEach((l) => l(url, null));
      }
    });
    this.resolveReady(wc);
  }

  fail(err: unknown): void {
    this.rejectReady(err);
  }

  onOpen(l: OpenListener): () => void {
    this.openListeners.add(l);
    return () => this.openListeners.delete(l);
  }

  onExit(l: ExitListener): () => void {
    this.exitListeners.add(l);
    return () => this.exitListeners.delete(l);
  }

  /* ---------------- perzistence ---------------- */

  private setImages(images: Image[]) {
    dockerStore.set({ images });
    void save(KEYS.images, images);
  }

  private setContainers(containers: Container[]) {
    dockerStore.set({ containers });
    if (this.saveContainersTimer) clearTimeout(this.saveContainersTimer);
    this.saveContainersTimer = setTimeout(() => void save(KEYS.containers, this.containers), 300);
  }

  private patchContainer(id: string, patch: Partial<Container>) {
    this.setContainers(this.containers.map((ct) => (ct.id === id ? { ...ct, ...patch } : ct)));
  }

  private scheduleLogSave() {
    if (this.saveLogsTimer) return;
    this.saveLogsTimer = setTimeout(() => {
      this.saveLogsTimer = null;
      const data: Record<string, LogEntry[]> = {};
      for (const ct of this.containers) data[ct.id] = (this.logs.get(ct.id) ?? []).slice(-500);
      void save('logs', data);
    }, 2000);
  }

  /* ---------------- vyhledávání ---------------- */

  findImage(ref: string): Image | undefined {
    const r = ref.replace(/^sha256:/, '');
    const tagged = normalizeRef(ref);
    return (
      this.images.find((i) => i.repoTags.includes(tagged)) ??
      (r.length >= 3 && /^[0-9a-f]+$/.test(r) ? this.images.find((i) => i.id.startsWith(r)) : undefined)
    );
  }

  findContainer(ref: string): Container | undefined {
    const name = ref.replace(/^\//, '');
    return (
      this.containers.find((ct) => ct.name === name) ??
      (name.length >= 1 && /^[0-9a-f]+$/.test(name) ? this.containers.find((ct) => ct.id.startsWith(name)) : undefined)
    );
  }

  imageLabel(ct: Container): string {
    const img = this.images.find((i) => i.id === ct.imageId);
    if (!img) return shortId(ct.imageId);
    if (img.repoTags.includes(normalizeRef(ct.image))) return ct.image;
    return img.repoTags[0] ?? shortId(img.id);
  }

  private containerForPort(port: number, allowUnassigned: boolean): Container | undefined {
    const running = this.containers.filter((ct) => ct.status === 'running');
    return (
      running.find((ct) => ct.internalPort === port) ??
      (allowUnassigned ? [...running].reverse().find((ct) => ct.internalPort == null) : undefined)
    );
  }

  /** Volný port ve WebContaineru (všechny kontejnery sdílí jednu síť). */
  allocatePort(preferred: number, reserved: Set<number> = new Set()): number {
    const used = new Set<number>([...reserved, ...this.foreignPorts]);
    for (const ct of this.containers) if (ct.status === 'running' && ct.internalPort) used.add(ct.internalPort);
    let p = preferred;
    while (used.has(p)) p++;
    return p;
  }

  private randomHostPort(): number {
    const used = new Set(this.containers.flatMap((ct) => ct.ports.map((p) => p.host)));
    let p = 32768;
    while (used.has(p)) p++;
    return p;
  }

  private randomName(): string {
    for (;;) {
      const n = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}_${NAMES[Math.floor(Math.random() * NAMES.length)]}`;
      if (!this.containers.some((ct) => ct.name === n)) return n;
    }
  }

  /* ---------------- souborový systém ---------------- */

  private async exists(path: string): Promise<boolean> {
    const wc = await this.ready;
    try {
      await wc.fs.readdir(path);
      return true;
    } catch {
      try {
        await wc.fs.readFile(path);
        return true;
      } catch {
        return false;
      }
    }
  }

  private async isDir(path: string): Promise<boolean> {
    const wc = await this.ready;
    try {
      await wc.fs.readdir(path);
      return true;
    } catch {
      return false;
    }
  }

  private async writeFile(path: string, content: string) {
    const wc = await this.ready;
    await wc.fs.mkdir(dirname(path) || '.', { recursive: true });
    await wc.fs.writeFile(path, content);
  }

  private async loadSnapshot(layerId: string): Promise<Uint8Array | undefined> {
    return load<Uint8Array>(KEYS.snapshot(layerId));
  }

  /** Namountuje snapshot vrstvy do složky (složku nejdřív vyčistí). */
  private async mountSnapshot(layerId: string, dir: string): Promise<void> {
    const wc = await this.ready;
    await wc.fs.rm(dir, { recursive: true, force: true });
    await wc.fs.mkdir(dir, { recursive: true });
    const snap = await this.loadSnapshot(layerId);
    if (!snap) throw new Error(`chybí snapshot vrstvy ${shortId(layerId)} (zkuste build s --no-cache)`);
    // mount() binární data "přenese" (detach) → předáváme kopii
    await wc.mount(snap.slice(), { mountPoint: dir });
  }

  /* ================================================================ */
  /* BUILD                                                             */
  /* ================================================================ */

  async build(opts: BuildOptions): Promise<Image | null> {
    const { out } = opts;
    const wc = await this.ready;
    const w = (s = '') => out.write(s + '\n');

    const dfPath = projectPath(opts.dockerfile);
    const dfText = opts.files[dfPath];
    const contextDir = projectPath(opts.contextDir);
    if (dfText === undefined) {
      w(c.red(`ERROR: failed to solve: failed to read dockerfile: open ${dfPath || 'Dockerfile'}: no such file or directory`));
      w(c.yellow(`→ V projektu chybí soubor ${dfPath}.`));
      return null;
    }
    if (contextDir && !Object.keys(opts.files).some((f) => isInside(f, contextDir))) {
      w(c.red(`unable to prepare context: path "${contextDir}" not found`));
      return null;
    }

    const ctx = contextFiles(opts.files, contextDir);
    const ctxPaths = Object.keys(ctx);
    const ctxSize = Object.values(ctx).reduce((s, v) => s + byteLength(v), 0);
    w(`Sending build context to Docker daemon  ${formatBytes(ctxSize)}`);

    const parsed = parseDockerfile(dfText, opts.buildArgs);
    if (!parsed.ok) {
      for (const d of parsed.diagnostics.filter((x) => x.severity === 'error')) {
        w(c.red(`Error response from daemon: dockerfile parse error on line ${d.line}: ${d.message}`));
      }
      return null;
    }

    /* ---- Fáze 1: plán (konfigurace + ID vrstev) ---- */
    type Kind = 'from' | 'workdir' | 'copy' | 'run' | 'meta';
    interface Step {
      display: string;
      kind: Kind;
      layerId: string;
      fs: boolean;
      line: number;
      workdir: string;
      env: Record<string, string>;
      warnings: string[];
      notes: string[];
      copy?: { files: { src: string; rel: string }[]; dest: string; destAbs: string; forceDir: boolean; missing: string[] };
      run?: { argv?: string[]; shell?: string; skipped: string[]; original: string };
      baseFiles?: Record<string, string>;
    }

    const buildArgs = opts.buildArgs ?? {};
    const argValues: Record<string, string> = {};
    const declaredArgs = new Set<string>();
    let config: ImageConfig | null = null;
    let flavor: BaseFlavor = 'node';
    let baseRef = '';
    let baseSize = 0;
    let copiedToDocRoot = false;
    let prevId = '';
    const steps: Step[] = [];

    for (const ins of parsed.instructions) {
      const display = `${ins.name} ${ins.args}`;
      const vars = () => ({ ...argValues, ...(config?.env ?? {}) });
      const step: Step = {
        display,
        kind: 'meta',
        layerId: '',
        fs: false,
        line: ins.line,
        workdir: config?.workdir ?? '/',
        env: { ...(config?.env ?? {}) },
        warnings: [],
        notes: [],
      };
      let extra = '';

      if (ins.ignored) {
        step.warnings.push(`Instrukce ${ins.name} je ve virtuálním Dockeru ignorována.`);
      } else {
        switch (ins.name) {
          case 'ARG': {
            for (const word of splitArgs(ins.args)) {
              const eq = word.indexOf('=');
              const k = eq < 0 ? word : word.slice(0, eq);
              declaredArgs.add(k);
              const def = eq < 0 ? undefined : expandVars(word.slice(eq + 1), vars());
              const v = buildArgs[k] ?? def;
              if (v !== undefined) argValues[k] = v;
            }
            extra = JSON.stringify(argValues);
            break;
          }
          case 'FROM': {
            baseRef = expandVars(splitArgs(ins.args)[0], vars());
            const info = classifyBase(baseRef);
            flavor = info.flavor!;
            const def = baseDefinition(flavor, info.tag);
            config = structuredClone(def.config);
            baseSize = def.size;
            step.kind = 'from';
            step.fs = true;
            step.baseFiles = def.files;
            step.workdir = config.workdir;
            extra = await sha256(JSON.stringify(def.files));
            if (flavor === 'nginx' || flavor === 'httpd') {
              step.notes.push(`${info.name} → ve virtuálním Dockeru ho nahrazuje malý statický Node HTTP server.`);
            } else {
              step.notes.push(`node:${info.tag} → běží nativně ve WebContaineru (verze Node.js se může lišit).`);
            }
            break;
          }
          case 'WORKDIR': {
            const wd = toAbs(expandVars(ins.args, vars()), config!.workdir);
            config!.workdir = wd;
            step.kind = 'workdir';
            step.fs = true;
            step.workdir = wd;
            break;
          }
          case 'COPY':
          case 'ADD': {
            const { flags, rest } = stripFlags(ins.args);
            const parts = (ins.json ?? splitArgs(rest)).map((p) => expandVars(p, vars()));
            const dest = parts[parts.length - 1];
            let sources = parts.slice(0, -1);
            const urls = sources.filter((s) => /^https?:\/\//.test(s));
            if (urls.length) {
              step.warnings.push(`ADD z URL není podporováno – přeskakuji: ${urls.join(', ')}`);
              sources = sources.filter((s) => !urls.includes(s));
            }
            if (flags.chown || flags.chmod) step.warnings.push('--chown/--chmod se ve virtuálním Dockeru ignoruje.');
            const resolved = resolveCopySources(sources, ctxPaths);
            const destAbs = toAbs(dest, config!.workdir);
            step.kind = 'copy';
            step.fs = true;
            step.copy = { ...resolved, dest, destAbs };
            const hashes = await Promise.all(
              resolved.files.map(async (f) => `${f.src}:${await sha256(ctx[f.src])}`),
            );
            extra = hashes.join('\n');
            if (config!.docRoot && isInside(destAbs, config!.docRoot)) copiedToDocRoot = true;
            break;
          }
          case 'RUN': {
            const original = ins.json ? ins.json.join(' ') : ins.args;
            step.kind = 'run';
            step.fs = true;
            step.env = { ...argValues, ...config!.env };
            if (ins.json) {
              step.run = { argv: ins.json, skipped: [], original };
            } else {
              const { run, skipped } = splitRunCommand(ins.args);
              step.run = { shell: run ?? undefined, skipped, original };
            }
            extra = JSON.stringify(argValues) + JSON.stringify(config!.env);
            break;
          }
          case 'ENV': {
            const kv = parseKeyValues(ins.args);
            if (kv) {
              for (const [k, v] of kv) config!.env[k] = expandVars(v, vars());
            } else {
              const [k, ...v] = splitArgs(ins.args);
              config!.env[k] = expandVars(v.join(' '), vars());
            }
            break;
          }
          case 'EXPOSE': {
            for (const p of splitArgs(expandVars(ins.args, vars()))) {
              const n = parseInt(p, 10);
              if (n && !config!.exposed.includes(n)) config!.exposed.push(n);
            }
            break;
          }
          case 'CMD':
            config!.cmd = toCommandArray(ins);
            break;
          case 'ENTRYPOINT':
            config!.entrypoint = toCommandArray(ins);
            // ENTRYPOINT v Dockerfile ruší CMD zděděné z base image
            config!.cmd = null;
            break;
          case 'LABEL':
            for (const [k, v] of parseKeyValues(ins.args) ?? []) config!.labels[k] = expandVars(v, vars());
            break;
        }
      }
      step.workdir = config?.workdir ?? step.workdir;
      step.layerId = await sha256(`${prevId}\n${display}\n${extra}`);
      prevId = step.layerId;
      steps.push(step);
    }

    const unused = Object.keys(buildArgs).filter((k) => !declaredArgs.has(k));
    if (unused.length) {
      w(c.yellow(`[Warning] One or more build-args [${unused.join(' ')}] were not consumed`));
    }

    if (!config) {
      w(c.red('Error response from daemon: No build stage in current context'));
      return null;
    }
    const finalConfig: ImageConfig = config;
    if (finalConfig.runtime === 'static' && !copiedToDocRoot && finalConfig.workdir !== '/' && finalConfig.workdir !== '/usr/local/apache2') {
      finalConfig.docRoot = finalConfig.workdir;
    }

    /* ---- Fáze 2: cache ---- */
    let firstMiss = opts.noCache ? 0 : steps.length;
    if (!opts.noCache) {
      for (let i = 0; i < steps.length; i++) {
        const rec = this.layers[steps[i].layerId];
        const hit = !!rec && (!steps[i].fs || (await this.loadSnapshot(steps[i].layerId)) !== undefined);
        if (!hit) {
          firstMiss = i;
          break;
        }
      }
    }

    /* ---- Fáze 3: provedení ---- */
    const buildDir = `${ROOT_BUILDS}/${randomHex(6)}`;
    const total = steps.length;
    let rootReady = false;
    let lastFsLayer = '';
    let lastSnapSize = 0;
    const layerOut: Layer[] = [];

    const ensureRoot = async (uptoIndex: number) => {
      if (rootReady) return;
      rootReady = true;
      await wc.fs.rm(buildDir, { recursive: true, force: true });
      await wc.fs.mkdir(buildDir, { recursive: true });
      for (let j = uptoIndex - 1; j >= 0; j--) {
        if (steps[j].fs) {
          await this.mountSnapshot(steps[j].layerId, buildDir);
          lastSnapSize = this.layers[steps[j].layerId]?.snapshotSize ?? 0;
          return;
        }
      }
    };

    const rootPath = (abs: string) => `${buildDir}${abs === '/' ? '' : abs}`;

    try {
      for (let i = 0; i < steps.length; i++) {
        if (opts.signal?.aborted) throw new BuildError('ERROR: build zrušen (Ctrl+C)');
        const st = steps[i];
        w(`Step ${i + 1}/${total} : ${st.display}`);
        for (const note of st.notes) w(c.gray(`ℹ ${note}`));
        for (const warning of st.warnings) w(c.yellow(`⚠ ${warning}`));
        const cached = i < firstMiss;

        if (cached) {
          if (st.kind !== 'from') w(' ---> Using cache');
          w(` ---> ${shortId(st.layerId)}`);
          if (st.fs) {
            lastFsLayer = st.layerId;
            lastSnapSize = this.layers[st.layerId]?.snapshotSize ?? lastSnapSize;
          }
          layerOut.push({ id: st.layerId, createdBy: st.display, size: this.layers[st.layerId]?.size ?? 0, fs: st.fs });
          continue;
        }

        await ensureRoot(i);
        let size = 0;
        const intermediate = randomHex(6);
        const announce = st.kind !== 'from' && st.kind !== 'copy';
        if (announce) w(` ---> Running in ${intermediate}`);

        switch (st.kind) {
          case 'from': {
            if (!this.layers[st.layerId]) {
              const { tag, name } = classifyBase(baseRef);
              w(`${tag}: Pulling from library/${name}`);
              w(`Digest: sha256:${(await sha256(baseRef)).slice(0, 64)}`);
              w(`Status: Downloaded newer image for ${normalizeRef(baseRef)}`);
            }
            for (const [p, content] of Object.entries(st.baseFiles ?? {})) await this.writeFile(rootPath(p), content);
            size = baseSize;
            break;
          }
          case 'workdir':
            await wc.fs.mkdir(rootPath(st.workdir), { recursive: true });
            break;
          case 'copy': {
            const cp = st.copy!;
            if (cp.missing.length) {
              throw new BuildError(
                `COPY failed: file not found in build context or excluded by .dockerignore: stat ${cp.missing[0]}: file does not exist`,
              );
            }
            if (!cp.files.length) {
              throw new BuildError('COPY failed: no source files were specified');
            }
            const destIsDir =
              cp.forceDir || cp.dest.endsWith('/') || cp.dest === '.' || (await this.isDir(rootPath(cp.destAbs)));
            for (const f of cp.files) {
              const target = destIsDir ? join(cp.destAbs, f.rel) : cp.destAbs;
              await this.writeFile(rootPath('/' + target.replace(/^\/+/, '')), ctx[f.src]);
              size += byteLength(ctx[f.src]);
            }
            break;
          }
          case 'run': {
            const r = st.run!;
            for (const s of r.skipped) {
              w(c.yellow(`⚠ Přeskakuji „${s}“ – správce balíčků OS není ve virtuálním Dockeru dostupný.`));
            }
            const cwd = rootPath(st.workdir);
            await wc.fs.mkdir(cwd, { recursive: true });
            if (r.argv || r.shell) {
              const [cmd, args] = r.argv ? spawnArgs(r.argv) : ['jsh', ['-c', r.shell!]];
              const code = await this.runProcess(cmd, args, { cwd, env: st.env, out, signal: opts.signal, cols: opts.cols });
              if (opts.signal?.aborted) throw new BuildError('ERROR: build zrušen (Ctrl+C)');
              if (code !== 0) {
                throw new BuildError(
                  `The command '${r.argv ? JSON.stringify(r.argv) : `/bin/sh -c ${r.original}`}' returned a non-zero code: ${code}`,
                );
              }
            } else {
              w(c.gray('(není co spustit)'));
            }
            break;
          }
          case 'meta':
            break;
        }

        if (announce) w(`Removing intermediate container ${intermediate}`);

        const rec: LayerRecord = { createdBy: st.display, size, fs: st.fs, created: Date.now() };
        if (st.fs) {
          const snap = await wc.export(buildDir, { format: 'binary' });
          rec.snapshotSize = snap.byteLength;
          if (st.kind === 'run') rec.size = Math.max(0, snap.byteLength - lastSnapSize);
          lastSnapSize = snap.byteLength;
          await save(KEYS.snapshot(st.layerId), snap);
          lastFsLayer = st.layerId;
        }
        this.layers[st.layerId] = rec;
        layerOut.push({ id: st.layerId, createdBy: st.display, size: rec.size, fs: st.fs });
        w(` ---> ${shortId(st.layerId)}`);
      }
    } catch (e) {
      w(c.red(e instanceof BuildError ? e.message : `ERROR: ${(e as Error).message ?? e}`));
      void save(KEYS.layers, this.layers);
      void wc.fs.rm(buildDir, { recursive: true, force: true }).catch(() => undefined);
      return null;
    }

    void wc.fs.rm(buildDir, { recursive: true, force: true }).catch(() => undefined);
    await save(KEYS.layers, this.layers);

    /* ---- Fáze 4: image ---- */
    const id = await sha256(JSON.stringify(finalConfig) + prevId);
    const tag = opts.tag ? normalizeRef(opts.tag) : null;
    const existing = this.images.find((i) => i.id === id);
    let images = this.images;
    if (tag) {
      // Tag přechází na nový image; starý bez tagů a bez kontejnerů se smaže
      images = images
        .map((img) => (img.id !== id && img.repoTags.includes(tag) ? { ...img, repoTags: img.repoTags.filter((t) => t !== tag) } : img))
        .filter((img) => img.repoTags.length > 0 || img.id === id || this.containers.some((ct) => ct.imageId === img.id));
    }
    const image: Image = existing
      ? { ...existing, repoTags: tag && !existing.repoTags.includes(tag) ? [...existing.repoTags, tag] : existing.repoTags }
      : {
          id,
          repoTags: tag ? [tag] : [],
          created: Date.now(),
          base: normalizeRef(baseRef),
          size: baseSize + lastSnapSize,
          layers: layerOut,
          config: finalConfig,
          snapshotLayer: lastFsLayer,
        };
    images = [image, ...images.filter((i) => i.id !== id)];
    this.setImages(images);
    void this.pruneLayers();

    w(`Successfully built ${shortId(id)}`);
    if (tag) w(`Successfully tagged ${tag}`);
    return image;
  }

  /** Spustí proces, přeposílá výstup do `out` a vrátí exit code. */
  private async runProcess(
    cmd: string,
    args: string[],
    o: { cwd: string; env: Record<string, string>; out: Out; signal?: AbortSignal; cols?: number },
  ): Promise<number> {
    const wc = await this.ready;
    const proc = await wc.spawn(cmd, args, {
      cwd: o.cwd,
      env: o.env,
      terminal: { cols: o.cols ?? 100, rows: 30 },
    });
    let last = '\n';
    const onAbort = () => proc.kill();
    o.signal?.addEventListener('abort', onAbort);
    void proc.output.pipeTo(
      new WritableStream({
        write(chunk) {
          if (chunk) last = chunk[chunk.length - 1];
          o.out.write(chunk);
        },
      }),
    ).catch(() => undefined);
    const code = await proc.exit;
    o.signal?.removeEventListener('abort', onAbort);
    await sleep(20);
    if (last !== '\n') o.out.write('\n');
    return code;
  }

  /** Smaže snapshoty vrstev, na které už neodkazuje žádný image. */
  async pruneLayers(): Promise<void> {
    const referenced = new Set(this.images.flatMap((i) => i.layers.map((l) => l.id)));
    let changed = false;
    for (const id of Object.keys(this.layers)) {
      if (referenced.has(id)) continue;
      // Čerstvé vrstvy (např. z nepovedeného buildu) necháme hodinu jako cache
      if (Date.now() - this.layers[id].created < 60 * 60 * 1000) continue;
      if (this.layers[id].fs) await removeKey(KEYS.snapshot(id));
      delete this.layers[id];
      changed = true;
    }
    if (changed) await save(KEYS.layers, this.layers);
  }

  /* ================================================================ */
  /* PULL (base image bez Dockerfile, např. `docker run nginx`)        */
  /* ================================================================ */

  async pull(ref: string, out: Out): Promise<Image | null> {
    const wc = await this.ready;
    const w = (s = '') => out.write(s + '\n');
    const full = normalizeRef(ref);
    const info = classifyBase(full);
    if (!info.supported) {
      w(c.red(`Error response from daemon: pull access denied for ${ref.split(':')[0]}, repository does not exist or may require 'docker login'`));
      w(c.yellow(`→ Image „${ref}“ není podporováno ve virtuálním Dockeru (podporováno: node, nginx, httpd).`));
      return null;
    }
    const def = baseDefinition(info.flavor!, info.tag);
    w(`${info.tag}: Pulling from library/${info.name}`);
    const fakeLayers = ['a1f2', '0c3d', 'e7b9'];
    for (const l of fakeLayers) w(`${(await sha256(full + l)).slice(0, 12)}: Pull complete`);
    const layerId = await sha256(`base\n${full}\n${JSON.stringify(def.files)}`);
    const dir = `${ROOT_BUILDS}/pull-${randomHex(4)}`;
    await wc.fs.rm(dir, { recursive: true, force: true });
    await wc.fs.mkdir(dir, { recursive: true });
    for (const [p, content] of Object.entries(def.files)) await this.writeFile(`${dir}${p}`, content);
    const snap = await wc.export(dir, { format: 'binary' });
    await save(KEYS.snapshot(layerId), snap);
    void wc.fs.rm(dir, { recursive: true, force: true });
    this.layers[layerId] = { createdBy: `FROM ${full}`, size: def.size, fs: true, snapshotSize: snap.byteLength, created: Date.now() };
    await save(KEYS.layers, this.layers);
    const id = await sha256(`image\n${full}\n${layerId}`);
    w(`Digest: sha256:${id}`);
    w(`Status: Downloaded newer image for ${full}`);
    const image: Image = {
      id,
      repoTags: [full],
      created: Date.now(),
      base: full,
      size: def.size,
      layers: [{ id: layerId, createdBy: `FROM ${full}`, size: def.size, fs: true }],
      config: def.config,
      snapshotLayer: layerId,
    };
    this.setImages([image, ...this.images.filter((i) => i.id !== id)]);
    return image;
  }

  /* ================================================================ */
  /* KONTEJNERY                                                        */
  /* ================================================================ */

  async create(opts: CreateOptions): Promise<Container> {
    await this.ready;
    const name = opts.name ?? this.randomName();
    const clash = this.containers.find((ct) => ct.name === name);
    if (clash) {
      throw new Error(
        `Conflict. The container name "/${name}" is already in use by container "${clash.id}". You have to remove (or rename) that container to be able to reuse that name.`,
      );
    }
    const img = opts.image;
    const entrypoint = opts.entrypoint ?? img.config.entrypoint ?? [];
    const cmd = opts.cmd ?? (opts.entrypoint ? [] : img.config.cmd ?? []);
    const ports = (opts.ports ?? []).map((p) => ({ ...p, host: p.host || this.randomHostPort() }));
    const ct: Container = {
      id: randomHex(32),
      name,
      image: opts.imageRef ?? opts.image.repoTags[0] ?? shortId(img.id),
      imageId: img.id,
      status: 'created',
      exitCode: null,
      created: Date.now(),
      startedAt: null,
      finishedAt: null,
      ports,
      internalPort: null,
      url: null,
      env: { ...img.config.env, ...(opts.env ?? {}) },
      command: [...entrypoint, ...cmd],
      workdir: opts.workdir ? toAbs(opts.workdir, img.config.workdir) : img.config.workdir,
      compose: opts.compose,
      autoRemove: opts.autoRemove,
      openOnReady: opts.openOnReady,
      userCmd: !!(opts.cmd?.length || opts.entrypoint),
    };
    this.setContainers([...this.containers, ct]);
    this.logs.set(ct.id, []);
    await this.mountSnapshot(img.snapshotLayer, `${ROOT_CONTAINERS}/${ct.id}`);
    return ct;
  }

  /** Spustí kontejner. `attachTerminal` = interaktivní režim (-it), vrací proces pro připojení terminálu. */
  async start(id: string, o: { reservedPorts?: Set<number>; terminal?: { cols: number; rows: number } } = {}): Promise<WebContainerProcess | null> {
    const wc = await this.ready;
    let ct = this.containers.find((x) => x.id === id);
    if (!ct) throw new Error(`No such container: ${id}`);
    if (ct.status === 'running') return null;
    const img = this.images.find((i) => i.id === ct!.imageId);
    const rootDir = `${ROOT_CONTAINERS}/${ct.id}`;
    if (!(await this.exists(rootDir))) {
      if (!img) throw new Error(`image ${shortId(ct.imageId)} pro kontejner už neexistuje`);
      await this.mountSnapshot(img.snapshotLayer, rootDir);
    }
    const rootAbs = `${wc.workdir}/${rootDir}`;
    const env: Record<string, string> = { ...ct.env };
    env.HOSTNAME = ct.id.slice(0, 12);

    // Port: preferujeme port z -p / EXPOSE, kolize řešíme posunem a předáme přes ENV PORT
    const preferred = env.PORT ? Number(env.PORT) : ct.ports[0]?.container ?? img?.config.exposed[0];
    let internalPort: number | null = null;
    if (preferred) {
      internalPort = this.allocatePort(preferred, o.reservedPorts);
      if (internalPort !== preferred) {
        this.pushLog(ct.id, c.yellow(`[minidocker] port ${preferred} je obsazený jiným kontejnerem → aplikace dostane PORT=${internalPort}`));
      }
      env.PORT = String(internalPort);
    }

    let cmd: string;
    let args: string[];
    if (img?.config.runtime === 'static' && !ct.userCmd) {
      env.MD_DOC_ROOT = `${rootAbs}${img.config.docRoot ?? img.config.workdir}`;
      env.MD_FLAVOR = img.config.flavor;
      cmd = 'node';
      args = [`${rootAbs}${STATIC_SERVER_PATH}`];
      // Starší image nemusí mít server v sobě
      if (!(await this.exists(`${rootDir}${STATIC_SERVER_PATH}`))) await this.writeFile(`${rootDir}${STATIC_SERVER_PATH}`, STATIC_SERVER_JS);
    } else {
      [cmd, args] = spawnArgs(ct.command.length ? ct.command : ['node']);
      args = args.map((a) => rewriteAbsPath(a, rootAbs));
    }

    const cwd = `${rootDir}${ct.workdir === '/' ? '' : ct.workdir}`;
    await wc.fs.mkdir(cwd, { recursive: true });
    const proc = await wc.spawn(cmd, args, { cwd, env, terminal: o.terminal ?? { cols: 120, rows: 30 } });

    this.patchContainer(ct.id, {
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      finishedAt: null,
      internalPort,
      url: null,
    });
    ct = this.containers.find((x) => x.id === id)!;

    const entry = { proc, killed: false, done: Promise.resolve() };
    if (!o.terminal) {
      void proc.output
        .pipeTo(new WritableStream({ write: (chunk) => this.appendOutput(id, chunk) }))
        .catch(() => undefined);
    }
    entry.done = proc.exit.then(async (code) => {
      await sleep(30);
      this.flushPartial(id);
      const killed = entry.killed;
      this.procs.delete(id);
      this.patchContainer(id, {
        status: 'exited',
        exitCode: killed ? 137 : code,
        finishedAt: Date.now(),
        url: null,
        internalPort: null,
      });
      const finished = this.containers.find((x) => x.id === id);
      if (finished) this.exitListeners.forEach((l) => l(finished));
      if (finished?.autoRemove) await this.remove(id, true).catch(() => undefined);
    });
    this.procs.set(id, entry);
    return o.terminal ? proc : null;
  }

  async stop(id: string): Promise<void> {
    const entry = this.procs.get(id);
    const ct = this.containers.find((x) => x.id === id);
    if (!entry) {
      if (ct?.status === 'running') this.patchContainer(id, { status: 'exited', exitCode: 137, finishedAt: Date.now(), url: null });
      return;
    }
    entry.killed = true;
    entry.proc.kill();
    await Promise.race([entry.done, sleep(4000)]);
    if (this.procs.has(id)) {
      this.procs.delete(id);
      this.patchContainer(id, { status: 'exited', exitCode: 137, finishedAt: Date.now(), url: null, internalPort: null });
    }
  }

  async restart(id: string): Promise<void> {
    await this.stop(id);
    await this.start(id);
  }

  async remove(id: string, force = false): Promise<void> {
    const wc = await this.ready;
    const ct = this.containers.find((x) => x.id === id);
    if (!ct) throw new Error(`No such container: ${id}`);
    if (ct.status === 'running') {
      if (!force) {
        throw new Error(
          `cannot remove container "/${ct.name}": container is running: stop the container before removing or force remove`,
        );
      }
      await this.stop(id);
    }
    this.setContainers(this.containers.filter((x) => x.id !== id));
    this.logs.delete(id);
    this.logListeners.delete(id);
    this.scheduleLogSave();
    await wc.fs.rm(`${ROOT_CONTAINERS}/${id}`, { recursive: true, force: true }).catch(() => undefined);
    // Image bez tagu, který držel jen tento kontejner (po rebuildu), už nikdo nepotřebuje
    const img = this.images.find((i) => i.id === ct.imageId);
    if (img && !img.repoTags.length && !this.containers.some((x) => x.imageId === img.id)) {
      await this.removeImage(img.id, true).catch(() => undefined);
    }
  }

  /** `docker rmi` – vrací řádky výstupu, při konfliktu vyhodí chybu. */
  async removeImage(ref: string, force = false): Promise<string[]> {
    const img = this.findImage(ref);
    if (!img) throw new Error(`No such image: ${ref}`);
    const users = this.containers.filter((ct) => ct.imageId === img.id);
    const running = users.find((ct) => ct.status === 'running');
    if (running) {
      throw new Error(
        `conflict: unable to remove repository reference "${ref}" (must force) - container ${shortId(running.id)} is using its referenced image ${shortId(img.id)}`,
      );
    }
    if (users.length && !force) {
      throw new Error(
        `conflict: unable to remove repository reference "${ref}" (must force) - container ${shortId(users[0].id)} is using its referenced image ${shortId(img.id)}`,
      );
    }
    const lines: string[] = [];
    const tag = normalizeRef(ref);
    if (img.repoTags.includes(tag) && img.repoTags.length > 1 && !force) {
      this.setImages(this.images.map((i) => (i.id === img.id ? { ...i, repoTags: i.repoTags.filter((t) => t !== tag) } : i)));
      return [`Untagged: ${tag}`];
    }
    for (const t of img.repoTags) lines.push(`Untagged: ${t}`);
    lines.push(`Deleted: sha256:${img.id}`);
    this.setImages(this.images.filter((i) => i.id !== img.id));
    // Okamžitě uvolníme snapshoty, na které už nic neodkazuje
    const referenced = new Set(this.images.flatMap((i) => i.layers.map((l) => l.id)));
    for (const l of img.layers) {
      if (!referenced.has(l.id) && this.layers[l.id]) {
        if (this.layers[l.id].fs) await removeKey(KEYS.snapshot(l.id));
        delete this.layers[l.id];
      }
    }
    await save(KEYS.layers, this.layers);
    return lines;
  }

  /** `docker tag` – tag se přesune z jiného image, pokud ho měl. */
  async tag(imageId: string, ref: string): Promise<void> {
    const t = normalizeRef(ref);
    this.setImages(
      this.images.map((img) => {
        if (img.id === imageId) return img.repoTags.includes(t) ? img : { ...img, repoTags: [...img.repoTags, t] };
        return img.repoTags.includes(t) ? { ...img, repoTags: img.repoTags.filter((x) => x !== t) } : img;
      }),
    );
  }

  /** Spustí příkaz uvnitř běžícího kontejneru (`docker exec`). */
  async exec(
    id: string,
    argv: string[],
    o: { env?: Record<string, string>; workdir?: string; terminal: { cols: number; rows: number } },
  ): Promise<WebContainerProcess> {
    const wc = await this.ready;
    const ct = this.containers.find((x) => x.id === id);
    if (!ct) throw new Error(`No such container: ${id}`);
    if (ct.status !== 'running') throw new Error(`container ${ct.id} is not running`);
    const rootDir = `${ROOT_CONTAINERS}/${ct.id}`;
    const rootAbs = `${wc.workdir}/${rootDir}`;
    const workdir = o.workdir ? toAbs(o.workdir, ct.workdir) : ct.workdir;
    const env: Record<string, string> = { ...ct.env, ...(o.env ?? {}), HOSTNAME: ct.id.slice(0, 12) };
    if (ct.internalPort) env.PORT = String(ct.internalPort);
    const [cmd, args] = spawnArgs(argv);
    return wc.spawn(cmd, args.map((a) => rewriteAbsPath(a, rootAbs)), {
      cwd: `${rootDir}${workdir === '/' ? '' : workdir}`,
      env,
      terminal: o.terminal,
    });
  }

  /* ---------------- logy ---------------- */

  /** Zapíše surový výstup procesu do logů kontejneru (řádkově). */
  appendOutput(id: string, chunk: string) {
    const buf = (this.partial.get(id) ?? '') + chunk;
    const parts = buf.split('\n');
    this.partial.set(id, parts.pop() ?? '');
    for (const raw of parts) {
      const noCr = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      const line = noCr.includes('\r') ? noCr.slice(noCr.lastIndexOf('\r') + 1) : noCr;
      this.pushLog(id, line);
    }
  }

  private flushPartial(id: string) {
    const rest = this.partial.get(id);
    if (rest) this.pushLog(id, rest.replace(/\r$/, ''));
    this.partial.delete(id);
  }

  pushLog(id: string, line: string) {
    const entry: LogEntry = { t: Date.now(), line };
    let arr = this.logs.get(id);
    if (!arr) {
      arr = [];
      this.logs.set(id, arr);
    }
    arr.push(entry);
    if (arr.length > MAX_LOG_LINES) arr.splice(0, arr.length - MAX_LOG_LINES);
    this.logListeners.get(id)?.forEach((l) => l(entry));
    this.scheduleLogSave();
  }

  getLogs(id: string): LogEntry[] {
    return this.logs.get(id) ?? [];
  }

  onLog(id: string, l: LogListener): () => void {
    let set = this.logListeners.get(id);
    if (!set) {
      set = new Set();
      this.logListeners.set(id, set);
    }
    set.add(l);
    return () => set!.delete(l);
  }

  /** Ukončí všechny procesy (Reset). */
  killAll(): void {
    for (const [, entry] of this.procs) {
      entry.killed = true;
      entry.proc.kill();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pomocné funkce pro spouštění                                         */
/* ------------------------------------------------------------------ */

const SHELLS = ['/bin/sh', 'sh', '/bin/bash', 'bash', '/bin/ash', 'ash', '/bin/zsh', 'zsh', 'jsh'];
const WRAPPERS = ['docker-entrypoint.sh', '/usr/local/bin/docker-entrypoint.sh', '/docker-entrypoint.sh', 'tini', '/sbin/tini', '/usr/bin/tini', 'dumb-init', '/usr/bin/dumb-init', '--', 'exec'];

function bin(x: string): string {
  return x.replace(/^\/(usr\/)?(local\/)?s?bin\//, '');
}

/** Převede argv (formát Dockeru) na příkaz pro webcontainer.spawn. */
export function spawnArgs(argv: string[]): [string, string[]] {
  const a = [...argv];
  while (a.length && WRAPPERS.includes(a[0])) a.shift();
  if (!a.length) return ['node', []];
  if (a[0].startsWith('-')) return ['node', a];
  if (SHELLS.includes(a[0])) {
    if (a[1] === '-c' && a[2] !== undefined) {
      const script = a[2].trim().replace(/^exec\s+/, '');
      if (isSimpleCommand(script)) {
        const words = splitArgs(script);
        if (words.length) return [bin(words[0]), words.slice(1)];
      }
      return ['jsh', ['-c', script]];
    }
    return ['jsh', a.slice(1)];
  }
  return [bin(a[0]), a.slice(1)];
}

/** `/app/server.js` → cesta uvnitř rootfs kontejneru ve WebContaineru. */
function rewriteAbsPath(arg: string, rootAbs: string): string {
  if (!arg.startsWith('/') || arg.startsWith(rootAbs)) return arg;
  if (/^\/(bin|sbin|usr\/bin|usr\/local\/bin|dev|proc|tmp)\b/.test(arg)) return arg;
  return `${rootAbs}${arg}`;
}

export const engine = new DockerEngine();
