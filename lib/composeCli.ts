'use client';

import yaml from 'js-yaml';
import { c, serviceColor } from './ansi';
import { fail, formatCommand, formatPorts, formatStatus, streamLogs, w, waitReady, type CliContext } from './cliCommon';
import { COMPOSE_FILES, parseCompose, parseDotenv, type ComposeProject, type ComposeService } from './compose';
import { classifyBase } from './dockerfile';
import { engine, normalizeRef } from './engine';
import { bool, parseFlags, str, type FlagDef } from './flags';
import { slugify, table, timeAgo } from './format';
import { dirname, join, projectPath } from './paths';
import { projectStore } from './project';
import type { Container, Image } from './types';

const GLOBAL_FLAGS: FlagDef[] = [
  { name: 'file', short: 'f', type: 'value' },
  { name: 'project-name', short: 'p', type: 'value' },
  { name: 'project-directory', type: 'value' },
];

const check = (s: string) => c.green('✔') + ' ' + s;

function loadProject(ctx: CliContext, fileFlag?: string, nameFlag?: string): ComposeProject | null {
  const files = projectStore.get().files;
  let file: string | undefined;
  if (fileFlag) {
    file = projectPath(fileFlag.startsWith('/') ? fileFlag : join(ctx.cwd, fileFlag));
    if (files[file] === undefined) {
      fail(ctx, `open ${fileFlag}: no such file or directory`);
      return null;
    }
  } else {
    // Hledáme v aktuální složce a výš (jako docker compose)
    let dir = ctx.cwd;
    for (;;) {
      file = COMPOSE_FILES.map((f) => join(dir, f)).find((f) => files[f] !== undefined);
      if (file || !dir) break;
      dir = dirname(dir) === '.' ? '' : dirname(dir);
    }
    if (!file) {
      fail(ctx, 'no configuration file provided: not found');
      w(ctx, c.yellow('→ Vytvořte docker-compose.yml nebo vyberte šablonu „Compose web + api“.'));
      return null;
    }
  }
  const dir = dirname(file) === '.' ? '' : dirname(file);
  const { project, issues } = parseCompose(files[file], {
    file,
    projectName: nameFlag ?? slugify(dir ? dir.split('/').pop()! : projectStore.get().name),
    dotenv: parseDotenv(files[join(dir, '.env')]),
  });
  for (const i of issues) {
    const where = i.line ? ` (${file}:${i.line})` : '';
    if (i.severity === 'error') fail(ctx, `${i.message}${where}`);
    else w(ctx, c.yellow(`WARN[0000] ${i.message}${where}`));
  }
  return project ?? null;
}

/** Vybrané služby včetně závislostí, v pořadí startu. */
function selectServices(project: ComposeProject, names: string[]): string[] | string {
  if (!names.length) return project.order;
  const want = new Set<string>();
  const add = (n: string) => {
    if (want.has(n)) return;
    want.add(n);
    project.services[n].dependsOn.forEach(add);
  };
  for (const n of names) {
    if (!project.services[n]) return `no such service: ${n}`;
    add(n);
  }
  return project.order.filter((n) => want.has(n));
}

function projectContainers(name: string): Container[] {
  return engine.containers.filter((ct) => ct.compose?.project === name);
}

function containerName(project: ComposeProject, svc: ComposeService): string {
  return svc.containerName ?? `${project.name}-${svc.name}-1`;
}

function prefixFor(project: ComposeProject, width: number) {
  return (service: string) => {
    const idx = project.order.indexOf(service);
    const label = `${service}-1`.padEnd(width);
    return serviceColor(idx < 0 ? 0 : idx)(`${label} |`);
  };
}

export async function composeCommand(args: string[], ctx: CliContext): Promise<number> {
  // Globální přepínače před podpříkazem
  let i = 0;
  const globalArgs: string[] = [];
  while (i < args.length && args[i].startsWith('-')) {
    globalArgs.push(args[i]);
    if (!args[i].includes('=') && ['-f', '--file', '-p', '--project-name', '--project-directory'].includes(args[i])) {
      globalArgs.push(args[++i]);
    }
    i++;
  }
  const g = parseFlags(globalArgs, GLOBAL_FLAGS);
  if (g.error) return fail(ctx, g.error);
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub || sub === 'help' || sub === '--help') {
    w(ctx, 'Usage:  docker compose [-f FILE] [-p NAME] COMMAND\n\nCommands: up, down, ps, logs, build, stop, start, restart, config');
    return 0;
  }

  const project = loadProject(ctx, str(g.flags, 'file'), str(g.flags, 'project-name'));
  if (!project) return 1;

  switch (sub) {
    case 'up':
      return up(project, rest, ctx);
    case 'down':
      return down(project, rest, ctx);
    case 'ps':
      return ps(project, rest, ctx);
    case 'logs':
      return logs(project, rest, ctx);
    case 'build':
      return buildCmd(project, rest, ctx);
    case 'stop':
    case 'start':
    case 'restart':
      return lifecycle(project, sub, rest, ctx);
    case 'config':
      w(ctx, yaml.dump({ name: project.name, services: project.services }, { noRefs: true, lineWidth: 120 }).trimEnd());
      return 0;
    default:
      return fail(ctx, `unknown docker compose command: "${sub}"`);
  }
}

/* ---------------- build ---------------- */

async function buildServices(
  project: ComposeProject,
  services: string[],
  ctx: CliContext,
  opts: { always: boolean; noCache?: boolean },
): Promise<Record<string, Image> | null> {
  const images: Record<string, Image> = {};
  for (const name of services) {
    const svc = project.services[name];
    if (svc.build) {
      const tag = svc.image ?? `${project.name}-${name}`;
      const existing = engine.findImage(tag);
      if (existing && !opts.always) {
        images[name] = existing;
        continue;
      }
      w(ctx, c.bold(c.brightBlue(`[+] Building ${name}`)) + c.gray(` (context: ./${svc.build.context || '.'})`));
      const img = await engine.build({
        tag,
        contextDir: svc.build.context,
        dockerfile: join(svc.build.context, svc.build.dockerfile),
        files: projectStore.get().files,
        buildArgs: svc.build.args,
        noCache: opts.noCache,
        out: ctx.out,
        signal: ctx.signal,
        cols: ctx.cols,
      });
      if (!img) {
        fail(ctx, `failed to solve: service "${name}" failed to build`);
        return null;
      }
      images[name] = img;
    } else if (svc.image) {
      let img = engine.findImage(svc.image);
      if (!img) {
        if (!classifyBase(normalizeRef(svc.image)).supported) {
          fail(ctx, `Error response from daemon: pull access denied for ${svc.image}`);
          w(ctx, c.yellow(`→ Služba „${name}“: image ${svc.image} není ve virtuálním Dockeru podporováno.`));
          return null;
        }
        w(ctx, c.bold(`[+] Pulling ${name}`));
        img = (await engine.pull(svc.image, ctx.out)) ?? undefined;
        if (!img) return null;
      }
      images[name] = img;
    }
  }
  return images;
}

async function buildCmd(project: ComposeProject, args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, [{ name: 'no-cache', type: 'bool' }, { name: 'pull', type: 'bool' }]);
  if (error) return fail(ctx, error);
  const services = selectServices(project, positional);
  if (typeof services === 'string') return fail(ctx, services);
  if (!(await waitReady(ctx))) return 1;
  const built = await buildServices(
    project,
    services.filter((s) => project.services[s].build),
    ctx,
    { always: true, noCache: bool(flags, 'no-cache') },
  );
  return built ? 0 : 1;
}

/* ---------------- up ---------------- */

const UP_FLAGS: FlagDef[] = [
  { name: 'detach', short: 'd', type: 'bool' },
  { name: 'build', type: 'bool' },
  { name: 'no-build', type: 'bool' },
  { name: 'force-recreate', type: 'bool' },
  { name: 'no-recreate', type: 'bool' },
  { name: 'remove-orphans', type: 'bool' },
  { name: 'wait', type: 'bool' },
  { name: 'no-cache', type: 'bool' },
];

/** Přepíše DNS názvy služeb (http://api:4000) na localhost:<skutečný port>. */
function rewriteDns(value: string, ports: Record<string, number | null>): string {
  let v = value;
  for (const [svc, port] of Object.entries(ports)) {
    if (!port) continue;
    const re = new RegExp(`(\\w+://)${svc.replace(/[.-]/g, '\\$&')}(:\\d+)?(?=[/?#]|$)`, 'g');
    v = v.replace(re, `$1localhost:${port}`);
    if (v === svc) v = 'localhost';
  }
  return v;
}

async function up(project: ComposeProject, args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, UP_FLAGS);
  if (error) return fail(ctx, error);
  const services = selectServices(project, positional);
  if (typeof services === 'string') return fail(ctx, services);
  if (!(await waitReady(ctx))) return 1;

  // 1) Build – MiniDocker staví vždy (díky cache vrstev je to rychlé), jako `up --build`
  const images = await buildServices(project, services, ctx, { always: !bool(flags, 'no-build'), noCache: bool(flags, 'no-cache') });
  if (!images) return 1;
  if (ctx.signal.aborted) return 130;

  const existing = projectContainers(project.name);
  const steps: string[] = [];
  const total = services.length + (existing.length ? 0 : 1);
  w(ctx, c.bold(`[+] Running ${total}/${total}`));
  if (!existing.length) {
    w(ctx, ` ${check(`Network ${project.name}_default`)}  ${c.green('Created')}`);
  }

  // 2) Rozhodnutí: ponechat běžící, nebo znovu vytvořit
  const keep = new Map<string, Container>();
  for (const name of services) {
    const svc = project.services[name];
    const ct = existing.find((x) => x.compose?.service === name);
    if (!ct) continue;
    const same = ct.imageId === images[name].id && ct.status === 'running' && !bool(flags, 'force-recreate');
    if (same || (bool(flags, 'no-recreate') && ct.status === 'running')) {
      keep.set(name, ct);
    } else {
      await engine.remove(ct.id, true);
      steps.push(`${containerName(project, svc)}  Recreate`);
    }
  }

  // 3) Porty (všechny služby sdílí jednu síť → každá musí mít vlastní port)
  const ports: Record<string, number | null> = {};
  const reserved = new Set<number>();
  for (const name of services) {
    const kept = keep.get(name);
    if (kept) {
      ports[name] = kept.internalPort;
      if (kept.internalPort) reserved.add(kept.internalPort);
    }
  }
  for (const name of services) {
    if (keep.has(name)) continue;
    const svc = project.services[name];
    const preferred =
      Number(svc.environment.PORT) || svc.ports[0]?.container || svc.expose[0] || images[name].config.exposed[0] || null;
    if (preferred) {
      const p = engine.allocatePort(preferred, reserved);
      reserved.add(p);
      ports[name] = p;
    } else {
      ports[name] = null;
    }
  }

  // 4) „DNS“ – URL ostatních služeb do ENV
  const dnsInfo: string[] = [];
  const envFor = (name: string): Record<string, string> => {
    const svc = project.services[name];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(svc.environment)) {
      const nv = rewriteDns(v, Object.fromEntries(Object.entries(ports).filter(([s]) => s !== name)));
      env[k] = nv;
      if (nv !== v) dnsInfo.push(`${name}-1: ${k}=${v} → ${nv}`);
    }
    for (const other of Object.keys(project.services)) {
      if (other === name || !ports[other]) continue;
      const key = `${other.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL`;
      if (!(key in env)) env[key] = `http://localhost:${ports[other]}`;
    }
    if (ports[name]) env.PORT = String(ports[name]);
    return env;
  };

  // 5) Start v pořadí podle depends_on
  const width = Math.max(...services.map((s) => `${s}-1`.length));
  const prefix = prefixFor(project, width);
  const started: Container[] = [];
  const pending: string[] = [];
  let attached = false;
  const unsubs: Array<() => void> = [];
  const primary = [...services].reverse().find((s) => project.services[s].ports.length) ?? services[services.length - 1];

  for (const name of services) {
    const svc = project.services[name];
    const cname = containerName(project, svc);
    const kept = keep.get(name);
    if (kept) {
      w(ctx, ` ${check(`Container ${cname}`)}  ${c.green('Running')}`);
      started.push(kept);
      continue;
    }
    try {
      const env = envFor(name);
      const ct = await engine.create({
        image: images[name],
        name: cname,
        ports: svc.ports,
        env,
        cmd: svc.command,
        entrypoint: svc.entrypoint,
        compose: { project: project.name, service: name, number: 1 },
        openOnReady: name === primary,
      });
      const injected = Object.keys(env).filter((k) => k.endsWith('_URL') && !(k in svc.environment));
      if (injected.length) {
        engine.pushLog(ct.id, c.gray(`[minidocker] DNS: ${injected.map((k) => `${k}=${env[k]}`).join(', ')}`));
      }
      unsubs.push(
        engine.onLog(ct.id, (e) => {
          const line = `${prefix(name)} ${e.line}\n`;
          if (attached) ctx.out.write(line);
          else pending.push(line);
        }),
      );
      await engine.start(ct.id);
      started.push(engine.containers.find((x) => x.id === ct.id) ?? ct);
      w(ctx, ` ${check(`Container ${cname}`)}  ${c.green(steps.some((s) => s.startsWith(cname)) ? 'Recreated' : 'Started')}`);
    } catch (e) {
      unsubs.forEach((u) => u());
      return fail(ctx, `Error response from daemon: ${(e as Error).message}`);
    }
  }

  // DNS informace (spec: "zmiň to v logu")
  const urlVars = services
    .filter((s) => ports[s])
    .map((s) => `${s.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL=http://localhost:${ports[s]}`);
  if (urlVars.length > 1 || dnsInfo.length) {
    w(ctx, c.gray(`ℹ DNS: služby sdílí jednu síť (localhost). Do ENV vloženo: ${urlVars.join(', ')}`));
    for (const d of dnsInfo) w(ctx, c.gray(`ℹ DNS: ${d}`));
  }

  if (bool(flags, 'detach')) {
    unsubs.forEach((u) => u());
    return 0;
  }

  // 6) Připojení k logům
  w(ctx, `Attaching to ${services.map((s) => `${s}-1`).join(', ')}`);
  w(ctx, c.gray('(Ctrl+C zastaví služby, klávesa „d“ odpojí terminál a služby poběží dál)'));
  attached = true;
  for (const line of pending) ctx.out.write(line);
  pending.length = 0;

  return new Promise<number>((resolve) => {
    const ids = new Set(started.map((ct) => ct.id));
    const running = new Set(started.filter((ct) => engine.containers.find((x) => x.id === ct.id)?.status === 'running').map((ct) => ct.id));
    let stopping = false;
    let resolveJob: () => void = () => undefined;
    const finish = (code: number) => {
      unsubs.forEach((u) => u());
      resolveJob();
      resolve(code);
    };
    unsubs.push(
      engine.onExit((ct) => {
        if (!ids.has(ct.id)) return;
        running.delete(ct.id);
        const svc = ct.compose?.service ?? ct.name;
        if (!stopping) ctx.out.write(`${serviceColor(project.order.indexOf(svc))(`${svc}-1 exited with code ${ct.exitCode ?? 0}`)}\n`);
        if (!running.size && !stopping) finish(0);
      }),
    );
    if (!running.size) {
      finish(0);
      return;
    }
    void ctx.attach({
      detachKey: true,
      onInterrupt: async () => {
        if (stopping) return;
        stopping = true;
        w(ctx, 'Gracefully stopping... (press Ctrl+C again to force)');
        w(ctx, c.bold(`[+] Stopping ${started.length}/${started.length}`));
        for (const ct of [...started].reverse()) {
          await engine.stop(ct.id);
          w(ctx, ` ${check(`Container ${ct.name}`)}  ${c.green('Stopped')}`);
        }
        finish(130);
      },
      onDetach: () => {
        w(ctx, c.gray('Odpojeno – služby běží dál na pozadí (docker compose ps / logs -f).'));
        finish(0);
      },
      done: new Promise<void>((r) => (resolveJob = r)),
    });
  });
}

/* ---------------- down ---------------- */

async function down(project: ComposeProject, args: string[], ctx: CliContext): Promise<number> {
  const { flags, error } = parseFlags(args, [
    { name: 'volumes', short: 'v', type: 'bool' },
    { name: 'rmi', type: 'value' },
    { name: 'remove-orphans', type: 'bool' },
    { name: 'timeout', short: 't', type: 'value' },
  ]);
  if (error) return fail(ctx, error);
  if (!(await waitReady(ctx))) return 1;
  const cts = projectContainers(project.name);
  const order = [...project.order].reverse();
  cts.sort((a, b) => order.indexOf(a.compose!.service) - order.indexOf(b.compose!.service));
  const rmi = str(flags, 'rmi');
  const imageIds = new Set(cts.map((ct) => ct.imageId));
  const total = cts.length + 1 + (rmi ? imageIds.size : 0);
  w(ctx, c.bold(`[+] Running ${total}/${total}`));
  for (const ct of cts) {
    if (ct.status === 'running') await engine.stop(ct.id);
    await engine.remove(ct.id, true);
    w(ctx, ` ${check(`Container ${ct.name}`)}  ${c.green('Removed')}`);
  }
  if (rmi === 'all' || rmi === 'local') {
    for (const id of imageIds) {
      const img = engine.images.find((x) => x.id === id);
      if (!img) continue;
      if (rmi === 'local' && !img.repoTags.some((t) => t.startsWith(`${project.name}-`))) continue;
      try {
        await engine.removeImage(img.id, true);
        w(ctx, ` ${check(`Image ${img.repoTags[0] ?? img.id.slice(0, 12)}`)}  ${c.green('Removed')}`);
      } catch (e) {
        w(ctx, c.yellow(` ! Image ${img.repoTags[0]}: ${(e as Error).message}`));
      }
    }
  }
  w(ctx, ` ${check(`Network ${project.name}_default`)}  ${c.green('Removed')}`);
  return 0;
}

/* ---------------- ps / logs / lifecycle ---------------- */

async function ps(project: ComposeProject, args: string[], ctx: CliContext): Promise<number> {
  const { flags, error } = parseFlags(args, [
    { name: 'all', short: 'a', type: 'bool' },
    { name: 'quiet', short: 'q', type: 'bool' },
    { name: 'services', type: 'bool' },
  ]);
  if (error) return fail(ctx, error);
  let cts = projectContainers(project.name);
  if (!bool(flags, 'all')) cts = cts.filter((ct) => ct.status === 'running');
  cts.sort((a, b) => a.name.localeCompare(b.name));
  if (bool(flags, 'quiet')) {
    for (const ct of cts) w(ctx, ct.id);
    return 0;
  }
  if (bool(flags, 'services')) {
    for (const ct of cts) w(ctx, ct.compose!.service);
    return 0;
  }
  ctx.out.write(
    table(
      ['NAME', 'IMAGE', 'COMMAND', 'SERVICE', 'CREATED', 'STATUS', 'PORTS'],
      cts.map((ct) => [
        ct.name,
        engine.imageLabel(ct),
        formatCommand(ct.command),
        ct.compose!.service,
        timeAgo(ct.created),
        formatStatus(ct),
        formatPorts(ct),
      ]),
    ),
  );
  return 0;
}

async function logs(project: ComposeProject, args: string[], ctx: CliContext): Promise<number> {
  const { flags, positional, error } = parseFlags(args, [
    { name: 'follow', short: 'f', type: 'bool' },
    { name: 'tail', short: 'n', type: 'value' },
    { name: 'timestamps', short: 't', type: 'bool' },
    { name: 'no-color', type: 'bool' },
  ]);
  if (error) return fail(ctx, error);
  for (const s of positional) if (!project.services[s]) return fail(ctx, `no such service: ${s}`);
  const cts = projectContainers(project.name).filter((ct) => !positional.length || positional.includes(ct.compose!.service));
  const width = Math.max(0, ...cts.map((ct) => `${ct.compose!.service}-1`.length));
  const prefix = prefixFor(project, width);
  const tail = str(flags, 'tail');
  await streamLogs(
    ctx,
    cts.map((ct) => ({ ct, prefix: prefix(ct.compose!.service) })),
    { follow: bool(flags, 'follow'), tail: tail && tail !== 'all' ? parseInt(tail, 10) : undefined, timestamps: bool(flags, 'timestamps') },
  );
  return 0;
}

async function lifecycle(project: ComposeProject, action: 'stop' | 'start' | 'restart', args: string[], ctx: CliContext): Promise<number> {
  const { positional, error } = parseFlags(args, [{ name: 'timeout', short: 't', type: 'value' }]);
  if (error) return fail(ctx, error);
  if (!(await waitReady(ctx))) return 1;
  let cts = projectContainers(project.name).filter((ct) => !positional.length || positional.includes(ct.compose!.service));
  const order = action === 'stop' ? [...project.order].reverse() : project.order;
  cts = cts.sort((a, b) => order.indexOf(a.compose!.service) - order.indexOf(b.compose!.service));
  if (!cts.length) {
    w(ctx, c.yellow('Žádné kontejnery – nejdřív spusťte „docker compose up“.'));
    return 0;
  }
  const label = { stop: 'Stopped', start: 'Started', restart: 'Started' }[action];
  w(ctx, c.bold(`[+] ${action === 'stop' ? 'Stopping' : action === 'start' ? 'Running' : 'Restarting'} ${cts.length}/${cts.length}`));
  for (const ct of cts) {
    try {
      if (action === 'stop') await engine.stop(ct.id);
      else if (action === 'start') await engine.start(ct.id);
      else await engine.restart(ct.id);
      w(ctx, ` ${check(`Container ${ct.name}`)}  ${c.green(label)}`);
    } catch (e) {
      w(ctx, c.red(` ✘ Container ${ct.name}  ${(e as Error).message}`));
    }
  }
  return 0;
}

