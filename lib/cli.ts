'use client';

import { c } from './ansi';
import {
  attachProcess,
  daemonError,
  fail,
  formatCommand,
  formatPorts,
  formatStatus,
  streamLogs,
  w,
  waitReady,
  type CliContext,
} from './cliCommon';
import { parsePort } from './compose';
import { composeCommand } from './composeCli';
import { classifyBase } from './dockerfile';
import { engine, normalizeRef } from './engine';
import { bool, list, parseFlags, str, type FlagDef } from './flags';
import { formatBytes, table, timeAgo } from './format';
import { shortId } from './hash';
import { join, normalize, projectPath } from './paths';
import { allDirs, PROJECT_DIR, projectStore } from './project';
import { splitArgs, splitShellSegments } from './shellwords';
import type { Image, PortMapping } from './types';

export type { CliContext } from './cliCommon';

const BUILTINS = new Set(['docker', 'docker-compose', 'help', 'cd', 'pwd']);

/* ------------------------------------------------------------------ */
/* Vstupní bod                                                         */
/* ------------------------------------------------------------------ */

export async function runCommandLine(line: string, ctx: CliContext): Promise<number> {
  const trimmed = line.trim();
  if (!trimmed) return 0;

  // `docker build … && docker run …` → zpracujeme po segmentech sami
  const { segments, separators } = splitShellSegments(trimmed);
  if (segments.length > 1 && segments.some((s) => BUILTINS.has(splitArgs(s)[0] ?? ''))) {
    let code = 0;
    for (let i = 0; i < segments.length; i++) {
      if (i > 0) {
        const sep = separators[i - 1];
        if (sep === '&&' && code !== 0) continue;
        if (sep === '||' && code === 0) continue;
      }
      if (ctx.signal.aborted) return 130;
      code = await runSingle(segments[i], ctx);
    }
    return code;
  }
  return runSingle(trimmed, ctx);
}

async function runSingle(line: string, ctx: CliContext): Promise<number> {
  const argv = splitArgs(line);
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'help':
      printHelp(ctx);
      return 0;
    case 'docker':
      return docker(rest, ctx);
    case 'docker-compose':
      return composeCommand(rest, ctx);
    case 'cd':
      return cd(rest[0], ctx);
    case 'pwd':
      w(ctx, `/${PROJECT_DIR}${ctx.cwd ? '/' + ctx.cwd : ''}`);
      return 0;
    default:
      return shell(line, ctx);
  }
}

/* ------------------------------------------------------------------ */
/* Shell (jsh) a vestavěné příkazy                                     */
/* ------------------------------------------------------------------ */

async function cd(target: string | undefined, ctx: CliContext): Promise<number> {
  if (!target || target === '~' || target === '/') {
    ctx.setCwd('');
    return 0;
  }
  const next = normalize(target.startsWith('/') ? target : join(ctx.cwd, target));
  if (next.startsWith('..')) {
    ctx.setCwd('');
    return 0;
  }
  const rel = projectPath(next);
  if (rel && !allDirs(projectStore.get()).has(rel)) {
    const wc = engine.wc;
    let ok = false;
    if (wc) {
      try {
        await wc.fs.readdir(`${PROJECT_DIR}/${rel}`);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) return fail(ctx, `cd: no such file or directory: ${target}`);
  }
  ctx.setCwd(rel);
  return 0;
}

async function shell(line: string, ctx: CliContext): Promise<number> {
  const wc = await waitReady(ctx);
  if (!wc) return 1;
  const interactive = /^(sh|bash|jsh|zsh|ash)$/.test(line.trim());
  const proc = await wc.spawn('jsh', interactive ? [] : ['-c', line], {
    cwd: `${PROJECT_DIR}${ctx.cwd ? '/' + ctx.cwd : ''}`,
    terminal: { cols: ctx.cols, rows: ctx.rows },
  });
  if (interactive) w(ctx, c.gray('Interaktivní jsh shell – ukončíte příkazem „exit“.'));
  return attachProcess(ctx, proc);
}

function printHelp(ctx: CliContext) {
  const cmd = (s: string, d: string) => `  ${c.cyan(s.padEnd(44))}${d}`;
  const lines = [
    c.bold('MiniDocker – virtuální Docker v prohlížeči'),
    '',
    c.bold('Images'),
    cmd('docker build -t <název> [-f Dockerfile] <kontext>', 'sestaví image'),
    cmd('docker images', 'seznam images'),
    cmd('docker rmi [-f] <image>', 'smaže image'),
    cmd('docker history <image>', 'vrstvy image'),
    cmd('docker pull <node|nginx|httpd>[:tag]', 'stáhne base image'),
    '',
    c.bold('Kontejnery'),
    cmd('docker run [-d] [-p 8080:3000] [--name n] [-e K=V] <image> [cmd]', ''),
    cmd('', 'spustí kontejner (-it pro interaktivní shell)'),
    cmd('docker ps [-a]', 'seznam kontejnerů'),
    cmd('docker stop|start|restart|rm [-f] <kontejner>', 'správa kontejnerů'),
    cmd('docker logs [-f] [--tail N] <kontejner>', 'logy kontejneru'),
    cmd('docker exec [-it] <kontejner> <příkaz>', 'příkaz uvnitř kontejneru'),
    cmd('docker inspect <kontejner|image>', 'detail v JSON'),
    '',
    c.bold('Compose'),
    cmd('docker compose up [-d] [--build]', 'sestaví a spustí služby'),
    cmd('docker compose down [--rmi all]', 'zastaví a odstraní služby'),
    cmd('docker compose ps [-a]', 'stav služeb'),
    cmd('docker compose logs [-f] [služba]', 'logy služeb s barevným prefixem'),
    cmd('docker compose build | stop | start | restart', ''),
    '',
    c.bold('Ostatní'),
    cmd('clear', 'vyčistí terminál (Ctrl+L)'),
    cmd('help', 'tato nápověda'),
    cmd('cd, ls, cat, node, npm, …', 'běží ve shellu WebContaineru (jsh)'),
    '',
    c.gray('Ctrl+C přeruší běžící příkaz · ↑/↓ historie příkazů · v `compose up` klávesa „d“ odpojí.'),
  ];
  w(ctx, lines.join('\n'));
}

/* ------------------------------------------------------------------ */
/* docker …                                                            */
/* ------------------------------------------------------------------ */

async function docker(args: string[], ctx: CliContext): Promise<number> {
  let [sub, ...rest] = args;
  // `docker container ls`, `docker image rm` …
  if (sub === 'container' || sub === 'image') {
    const map: Record<string, string> = {
      'container:ls': 'ps', 'container:list': 'ps', 'container:run': 'run', 'container:stop': 'stop',
      'container:start': 'start', 'container:restart': 'restart', 'container:rm': 'rm', 'container:logs': 'logs',
      'container:exec': 'exec', 'container:inspect': 'inspect', 'image:ls': 'images', 'image:list': 'images',
      'image:rm': 'rmi', 'image:build': 'build', 'image:history': 'history', 'image:inspect': 'inspect',
      'image:pull': 'pull', 'image:tag': 'tag',
    };
    const mapped = map[`${sub}:${rest[0]}`];
    if (!mapped) return fail(ctx, `docker: '${sub} ${rest[0] ?? ''}' is not a docker command.`);
    sub = mapped;
    rest = rest.slice(1);
  }

  switch (sub) {
    case undefined:
    case 'help':
    case '--help':
      printHelp(ctx);
      return 0;
    case 'version':
    case '--version':
    case '-v':
      return version(ctx);
    case 'build':
      return build(rest, ctx);
    case 'run':
      return run(rest, ctx);
    case 'ps':
      return ps(rest, ctx);
    case 'images':
      return images(rest, ctx);
    case 'stop':
    case 'kill':
      return lifecycle('stop', rest, ctx);
    case 'start':
      return lifecycle('start', rest, ctx);
    case 'restart':
      return lifecycle('restart', rest, ctx);
    case 'rm':
      return rm(rest, ctx);
    case 'rmi':
      return rmi(rest, ctx);
    case 'logs':
      return logs(rest, ctx);
    case 'exec':
      return exec(rest, ctx);
    case 'compose':
      return composeCommand(rest, ctx);
    case 'pull':
      return pull(rest, ctx);
    case 'inspect':
      return inspect(rest, ctx);
    case 'history':
      return history(rest, ctx);
    case 'tag':
      return tag(rest, ctx);
    default:
      return fail(ctx, `docker: '${sub}' is not a docker command.\nSee 'help' for supported commands.`);
  }
}

function version(ctx: CliContext): number {
  w(
    ctx,
    [
      'Client: MiniDocker',
      ' Version:           1.0.0 (virtuální Docker CLI)',
      ' OS/Arch:           browser/wasm',
      '',
      'Server: MiniDocker Engine',
      ` Engine:            WebContainer (Node.js ${engine.wc ? 'běží' : 'nespuštěn'})`,
      ' Podporované base:  node:*, nginx:*, httpd:*',
    ].join('\n'),
  );
  return 0;
}

/* ---------------- build ---------------- */

const BUILD_FLAGS: FlagDef[] = [
  { name: 'tag', short: 't', type: 'multi' },
  { name: 'file', short: 'f', type: 'value' },
  { name: 'build-arg', type: 'multi' },
  { name: 'no-cache', type: 'bool' },
  { name: 'quiet', short: 'q', type: 'bool' },
  { name: 'pull', type: 'bool' },
  { name: 'rm', type: 'bool' },
  { name: 'progress', type: 'value' },
  { name: 'platform', type: 'value' },
];

/** Cesta z terminálu (relativní k cwd) → cesta v projektu. */
function resolvePath(ctx: CliContext, p: string): string {
  return projectPath(p.startsWith('/') ? p : join(ctx.cwd, p));
}

export async function build(args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, BUILD_FLAGS);
  if (error) return fail(ctx, error);
  if (positional.length !== 1) {
    return fail(ctx, '"docker build" requires exactly 1 argument.\nUsage:  docker build [OPTIONS] PATH');
  }
  if (!(await waitReady(ctx))) return 1;
  const contextDir = resolvePath(ctx, positional[0]);
  const fileFlag = str(flags, 'file');
  const dockerfile = fileFlag ? resolvePath(ctx, fileFlag) : join(contextDir, 'Dockerfile');
  const buildArgs: Record<string, string> = {};
  for (const kv of list(flags, 'build-arg')) {
    const eq = kv.indexOf('=');
    if (eq > 0) buildArgs[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  const tags = list(flags, 'tag');
  for (const t of tags) {
    if (!/^[a-z0-9][a-z0-9._/-]*(:[\w][\w.-]{0,127})?$/.test(t)) {
      return fail(ctx, `invalid argument "${t}" for "-t, --tag" flag: invalid reference format: repository name must be lowercase`);
    }
  }
  const quiet = bool(flags, 'quiet');
  const image = await engine.build({
    tag: tags[0],
    contextDir,
    dockerfile,
    files: projectStore.get().files,
    buildArgs,
    noCache: bool(flags, 'no-cache'),
    out: quiet ? { write: () => undefined } : ctx.out,
    signal: ctx.signal,
    cols: ctx.cols,
  });
  if (!image) return 1;
  for (const t of tags.slice(1)) await engine.tag(image.id, t);
  if (quiet) w(ctx, `sha256:${image.id}`);
  for (const t of tags.slice(1)) w(ctx, `Successfully tagged ${normalizeRef(t)}`);
  return 0;
}

/* ---------------- run ---------------- */

const RUN_FLAGS: FlagDef[] = [
  { name: 'detach', short: 'd', type: 'bool' },
  { name: 'interactive', short: 'i', type: 'bool' },
  { name: 'tty', short: 't', type: 'bool' },
  { name: 'rm', type: 'bool' },
  { name: 'publish-all', short: 'P', type: 'bool' },
  { name: 'publish', short: 'p', type: 'multi' },
  { name: 'env', short: 'e', type: 'multi' },
  { name: 'env-file', type: 'multi' },
  { name: 'name', type: 'value' },
  { name: 'workdir', short: 'w', type: 'value' },
  { name: 'entrypoint', type: 'value' },
  { name: 'volume', short: 'v', type: 'multi' },
  { name: 'network', aliases: ['net'], type: 'value' },
  { name: 'restart', type: 'value' },
  { name: 'hostname', short: 'h', type: 'value' },
  { name: 'label', short: 'l', type: 'multi' },
  { name: 'memory', short: 'm', type: 'value' },
  { name: 'cpus', type: 'value' },
  { name: 'user', short: 'u', type: 'value' },
  { name: 'platform', type: 'value' },
  { name: 'pull', type: 'value' },
];

function parseEnvList(items: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const kv of items) {
    const eq = kv.indexOf('=');
    if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return env;
}

async function resolveImageOrPull(ref: string, ctx: CliContext): Promise<Image | null> {
  const img = engine.findImage(ref);
  if (img) return img;
  const base = classifyBase(normalizeRef(ref));
  w(ctx, `Unable to find image '${normalizeRef(ref)}' locally`);
  if (!base.supported) {
    fail(ctx, `docker: Error response from daemon: pull access denied for ${ref.split(':')[0]}, repository does not exist or may require 'docker login'.`);
    w(ctx, c.yellow('→ Lokálně sestavte image příkazem „docker build -t <název> .“ (nebo tlačítkem Build).'));
    return null;
  }
  return engine.pull(ref, ctx.out);
}

export async function run(args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, RUN_FLAGS, { stopAtPositional: true });
  if (error) return fail(ctx, `docker: ${error}`);
  if (!positional.length) return fail(ctx, '"docker run" requires at least 1 argument.\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]');
  if (!(await waitReady(ctx))) return 1;

  const [ref, ...cmd] = positional;
  const image = await resolveImageOrPull(ref, ctx);
  if (!image) return 125;

  const ports: PortMapping[] = [];
  for (const spec of list(flags, 'publish')) {
    const pm = parsePort(spec);
    if (!pm) return fail(ctx, `docker: invalid publish spec: ${spec}`);
    ports.push(pm);
  }
  if (bool(flags, 'publish-all')) {
    for (const p of image.config.exposed) if (!ports.some((x) => x.container === p)) ports.push({ host: 0, container: p });
  }
  if (list(flags, 'volume').length) w(ctx, c.yellow('⚠ Volumes (-v) nejsou ve virtuálním Dockeru podporovány – ignoruji.'));
  if (str(flags, 'network')) w(ctx, c.gray('ℹ Všechny kontejnery sdílí jednu síť (localhost) – --network se ignoruje.'));

  const env: Record<string, string> = {};
  for (const f of list(flags, 'env-file')) {
    const content = projectStore.get().files[resolvePath(ctx, f)];
    if (content === undefined) return fail(ctx, `docker: open ${f}: no such file or directory.`);
    Object.assign(env, parseEnvList(content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))));
  }
  Object.assign(env, parseEnvList(list(flags, 'env')));

  const detach = bool(flags, 'detach');
  const tty = bool(flags, 'tty') && bool(flags, 'interactive');
  const entrypoint = str(flags, 'entrypoint');

  let ct;
  try {
    ct = await engine.create({
      image,
      imageRef: ref,
      name: str(flags, 'name'),
      ports,
      env,
      cmd: cmd.length ? cmd : undefined,
      entrypoint: entrypoint !== undefined ? splitArgs(entrypoint) : undefined,
      workdir: str(flags, 'workdir'),
      autoRemove: bool(flags, 'rm'),
      openOnReady: true,
    });
  } catch (e) {
    return fail(ctx, `docker: Error response from daemon: ${(e as Error).message}`);
  }

  if (image.config.runtime === 'static' && !cmd.length) {
    w(ctx, c.gray(`ℹ ${image.config.flavor} → statický server servíruje ${image.config.docRoot ?? image.config.workdir}`));
  }

  // Interaktivní režim: terminál je přímo připojený k procesu kontejneru
  if (tty && !detach) {
    try {
      const proc = await engine.start(ct.id, { terminal: { cols: ctx.cols, rows: ctx.rows } });
      if (!proc) return 0;
      const code = await attachProcess(ctx, proc, { tee: (chunk) => engine.appendOutput(ct.id, chunk) });
      return code;
    } catch (e) {
      return fail(ctx, `docker: Error response from daemon: ${(e as Error).message}`);
    }
  }

  if (detach) {
    try {
      await engine.start(ct.id);
    } catch (e) {
      return fail(ctx, `docker: Error response from daemon: ${(e as Error).message}`);
    }
    w(ctx, ct.id);
    const mapped = ct.ports.map((p) => `${p.host}→${p.container}`).join(', ');
    w(ctx, c.gray(`ℹ Kontejner ${ct.name} běží${mapped ? ` (porty ${mapped})` : ''}. Po startu serveru se otevře záložka Prohlížeč.`));
    return 0;
  }

  // Připojený režim (bez -d): sledujeme logy, Ctrl+C kontejner zastaví
  return new Promise<number>((resolve) => {
    let detached = false;
    const unsubLog = engine.onLog(ct!.id, (e) => ctx.out.write(e.line + '\n'));
    const unsubExit = engine.onExit((x) => {
      if (x.id !== ct!.id) return;
      done(x.exitCode ?? 0);
    });
    let resolveJob: () => void = () => undefined;
    const done = (code: number) => {
      unsubLog();
      unsubExit();
      resolveJob();
      resolve(code);
    };
    void ctx.attach({
      onInterrupt: () => {
        w(ctx, c.gray('^C – zastavuji kontejner…'));
        void engine.stop(ct!.id);
      },
      onDetach: () => {
        detached = true;
        w(ctx, c.gray(`Odpojeno – kontejner ${ct!.name} běží dál na pozadí.`));
        done(0);
      },
      done: new Promise<void>((r) => (resolveJob = r)),
    });
    engine.start(ct!.id).catch((e) => {
      if (!detached) {
        fail(ctx, `docker: Error response from daemon: ${(e as Error).message}`);
        done(125);
      }
    });
  });
}

/* ---------------- ps / images ---------------- */

async function ps(args: string[], ctx: CliContext): Promise<number> {
  const { flags, error } = parseFlags(args, [
    { name: 'all', short: 'a', type: 'bool' },
    { name: 'quiet', short: 'q', type: 'bool' },
    { name: 'no-trunc', type: 'bool' },
    { name: 'latest', short: 'l', type: 'bool' },
  ]);
  if (error) return fail(ctx, error);
  let list_ = [...engine.containers].sort((a, b) => b.created - a.created);
  if (!bool(flags, 'all') && !bool(flags, 'latest')) list_ = list_.filter((ct) => ct.status === 'running');
  if (bool(flags, 'latest')) list_ = list_.slice(0, 1);
  if (bool(flags, 'quiet')) {
    for (const ct of list_) w(ctx, shortId(ct.id));
    return 0;
  }
  ctx.out.write(
    table(
      ['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES'],
      list_.map((ct) => [
        shortId(ct.id),
        engine.imageLabel(ct),
        formatCommand(ct.command),
        timeAgo(ct.created),
        formatStatus(ct),
        formatPorts(ct),
        ct.name,
      ]),
    ),
  );
  return 0;
}

async function images(args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, [
    { name: 'all', short: 'a', type: 'bool' },
    { name: 'quiet', short: 'q', type: 'bool' },
  ]);
  if (error) return fail(ctx, error);
  const rows: string[][] = [];
  const ids: string[] = [];
  for (const img of engine.images) {
    const tags = img.repoTags.length ? img.repoTags : ['<none>:<none>'];
    for (const t of tags) {
      const i = t.lastIndexOf(':');
      const repo = t.slice(0, i);
      if (positional[0] && repo !== positional[0]) continue;
      rows.push([repo, t.slice(i + 1), shortId(img.id), timeAgo(img.created), formatBytes(img.size)]);
      ids.push(shortId(img.id));
    }
  }
  if (bool(flags, 'quiet')) {
    for (const id of new Set(ids)) w(ctx, id);
    return 0;
  }
  ctx.out.write(table(['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE'], rows));
  return 0;
}

/* ---------------- stop / start / restart / rm / rmi ---------------- */

async function lifecycle(action: 'stop' | 'start' | 'restart', args: string[], ctx: CliContext): Promise<number> {
  const { positional, error } = parseFlags(args, [
    { name: 'time', short: 't', type: 'value' },
    { name: 'attach', short: 'a', type: 'bool' },
    { name: 'interactive', short: 'i', type: 'bool' },
    { name: 'signal', short: 's', type: 'value' },
  ]);
  if (error) return fail(ctx, error);
  if (!positional.length) return fail(ctx, `"docker ${action}" requires at least 1 argument.`);
  if (!(await waitReady(ctx))) return 1;
  let code = 0;
  for (const ref of positional) {
    const ct = engine.findContainer(ref);
    if (!ct) {
      code = daemonError(ctx, `No such container: ${ref}`);
      continue;
    }
    try {
      if (action === 'stop') await engine.stop(ct.id);
      else if (action === 'start') await engine.start(ct.id);
      else await engine.restart(ct.id);
      w(ctx, ref);
    } catch (e) {
      code = daemonError(ctx, (e as Error).message);
    }
  }
  return code;
}

async function rm(args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, [
    { name: 'force', short: 'f', type: 'bool' },
    { name: 'volumes', short: 'v', type: 'bool' },
  ]);
  if (error) return fail(ctx, error);
  if (!positional.length) return fail(ctx, '"docker rm" requires at least 1 argument.');
  if (!(await waitReady(ctx))) return 1;
  let code = 0;
  for (const ref of positional) {
    const ct = engine.findContainer(ref);
    if (!ct) {
      code = daemonError(ctx, `No such container: ${ref}`);
      continue;
    }
    try {
      await engine.remove(ct.id, bool(flags, 'force'));
      w(ctx, ref);
    } catch (e) {
      code = daemonError(ctx, (e as Error).message);
    }
  }
  return code;
}

async function rmi(args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, [{ name: 'force', short: 'f', type: 'bool' }]);
  if (error) return fail(ctx, error);
  if (!positional.length) return fail(ctx, '"docker rmi" requires at least 1 argument.');
  let code = 0;
  for (const ref of positional) {
    try {
      for (const line of await engine.removeImage(ref, bool(flags, 'force'))) w(ctx, line);
    } catch (e) {
      code = daemonError(ctx, (e as Error).message);
    }
  }
  return code;
}

async function tag(args: string[], ctx: CliContext): Promise<number> {
  if (args.length !== 2) return fail(ctx, '"docker tag" requires exactly 2 arguments.\nUsage:  docker tag SOURCE_IMAGE[:TAG] TARGET_IMAGE[:TAG]');
  const img = engine.findImage(args[0]);
  if (!img) return daemonError(ctx, `No such image: ${args[0]}`);
  await engine.tag(img.id, args[1]);
  return 0;
}

async function pull(args: string[], ctx: CliContext): Promise<number> {
  if (args.length !== 1) return fail(ctx, '"docker pull" requires exactly 1 argument.');
  if (!(await waitReady(ctx))) return 1;
  const img = await engine.pull(args[0], ctx.out);
  if (img) w(ctx, `docker.io/library/${normalizeRef(args[0])}`);
  return img ? 0 : 1;
}

/* ---------------- logs / exec ---------------- */

async function logs(args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, [
    { name: 'follow', short: 'f', type: 'bool' },
    { name: 'tail', short: 'n', type: 'value' },
    { name: 'timestamps', short: 't', type: 'bool' },
    { name: 'since', type: 'value' },
  ]);
  if (error) return fail(ctx, error);
  if (positional.length !== 1) return fail(ctx, '"docker logs" requires exactly 1 argument.');
  const ct = engine.findContainer(positional[0]);
  if (!ct) return daemonError(ctx, `No such container: ${positional[0]}`);
  const tailFlag = str(flags, 'tail');
  await streamLogs(ctx, [{ ct }], {
    follow: bool(flags, 'follow'),
    tail: tailFlag && tailFlag !== 'all' ? parseInt(tailFlag, 10) : undefined,
    timestamps: bool(flags, 'timestamps'),
  });
  return 0;
}

async function exec(args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(
    args,
    [
      { name: 'interactive', short: 'i', type: 'bool' },
      { name: 'tty', short: 't', type: 'bool' },
      { name: 'detach', short: 'd', type: 'bool' },
      { name: 'env', short: 'e', type: 'multi' },
      { name: 'workdir', short: 'w', type: 'value' },
      { name: 'user', short: 'u', type: 'value' },
    ],
    { stopAtPositional: true },
  );
  if (error) return fail(ctx, error);
  if (positional.length < 2) return fail(ctx, '"docker exec" requires at least 2 arguments.\nUsage:  docker exec [OPTIONS] CONTAINER COMMAND [ARG...]');
  if (!(await waitReady(ctx))) return 1;
  const ct = engine.findContainer(positional[0]);
  if (!ct) return daemonError(ctx, `No such container: ${positional[0]}`);
  try {
    const proc = await engine.exec(ct.id, positional.slice(1), {
      env: parseEnvList(list(flags, 'env')),
      workdir: str(flags, 'workdir'),
      terminal: { cols: ctx.cols, rows: ctx.rows },
    });
    if (bool(flags, 'detach')) return 0;
    return await attachProcess(ctx, proc, { interactive: bool(flags, 'interactive') });
  } catch (e) {
    const msg = (e as Error).message;
    if (/not running/.test(msg)) return daemonError(ctx, `Container ${ct.id} is not running`);
    return fail(ctx, `OCI runtime exec failed: ${msg}`);
  }
}

/* ---------------- inspect / history ---------------- */

async function inspect(args: string[], ctx: CliContext): Promise<number> {
  if (!args.length) return fail(ctx, '"docker inspect" requires at least 1 argument.');
  const result: unknown[] = [];
  for (const ref of args) {
    const ct = engine.findContainer(ref);
    if (ct) {
      result.push({
        Id: ct.id,
        Created: new Date(ct.created).toISOString(),
        Path: ct.command[0],
        Args: ct.command.slice(1),
        State: {
          Status: ct.status,
          Running: ct.status === 'running',
          ExitCode: ct.exitCode ?? 0,
          StartedAt: ct.startedAt ? new Date(ct.startedAt).toISOString() : null,
          FinishedAt: ct.finishedAt ? new Date(ct.finishedAt).toISOString() : null,
        },
        Image: `sha256:${ct.imageId}`,
        Name: `/${ct.name}`,
        Config: {
          Hostname: ct.id.slice(0, 12),
          Env: Object.entries(ct.env).map(([k, v]) => `${k}=${v}`),
          Cmd: ct.command,
          Image: ct.image,
          WorkingDir: ct.workdir,
          Labels: ct.compose
            ? { 'com.docker.compose.project': ct.compose.project, 'com.docker.compose.service': ct.compose.service }
            : {},
        },
        NetworkSettings: {
          Ports: Object.fromEntries(ct.ports.map((p) => [`${p.container}/tcp`, [{ HostIp: '0.0.0.0', HostPort: String(p.host) }]])),
        },
        MiniDocker: { InternalPort: ct.internalPort, PreviewUrl: ct.url, RootFs: `/containers/${ct.id}` },
      });
      continue;
    }
    const img = engine.findImage(ref);
    if (img) {
      result.push({
        Id: `sha256:${img.id}`,
        RepoTags: img.repoTags,
        Created: new Date(img.created).toISOString(),
        Size: img.size,
        Config: {
          Env: Object.entries(img.config.env).map(([k, v]) => `${k}=${v}`),
          Cmd: img.config.cmd,
          Entrypoint: img.config.entrypoint,
          WorkingDir: img.config.workdir,
          ExposedPorts: Object.fromEntries(img.config.exposed.map((p) => [`${p}/tcp`, {}])),
          Labels: img.config.labels,
        },
        RootFS: { Type: 'layers', Layers: img.layers.filter((l) => l.fs).map((l) => `sha256:${l.id}`) },
        MiniDocker: { Base: img.base, Runtime: img.config.runtime, DocRoot: img.config.docRoot },
      });
      continue;
    }
    w(ctx, '[]');
    return daemonError(ctx, `No such object: ${ref}`);
  }
  w(ctx, JSON.stringify(result, null, 4));
  return 0;
}

async function history(args: string[], ctx: CliContext): Promise<number> {
  if (args.length !== 1) return fail(ctx, '"docker history" requires exactly 1 argument.');
  const img = engine.findImage(args[0]);
  if (!img) return daemonError(ctx, `No such image: ${args[0]}`);
  const rows = [...img.layers].reverse().map((l, i) => [
    i === 0 ? shortId(img.id) : shortId(l.id),
    timeAgo(img.created),
    l.createdBy.length > 45 ? l.createdBy.slice(0, 44) + '…' : l.createdBy,
    formatBytes(l.size),
    l.createdBy.startsWith('FROM') ? 'base image' : '',
  ]);
  ctx.out.write(table(['IMAGE', 'CREATED', 'CREATED BY', 'SIZE', 'COMMENT'], rows));
  return 0;
}
