import { expandVars, parseKeyValues, splitArgs, splitShellSegments } from './shellwords';
import type { BaseFlavor } from './types';

export const SUPPORTED = ['FROM', 'WORKDIR', 'COPY', 'ADD', 'RUN', 'ENV', 'ARG', 'EXPOSE', 'CMD', 'ENTRYPOINT', 'LABEL'] as const;
/** Instrukce, které Docker zná, ale virtuální Docker je jen přeskočí. */
const IGNORED = ['USER', 'VOLUME', 'HEALTHCHECK', 'SHELL', 'STOPSIGNAL', 'ONBUILD', 'MAINTAINER'];

export interface Instruction {
  name: string;
  /** Argumenty po spojení víceřádkových příkazů (`\`). */
  args: string;
  /** Exec forma `["node","server.js"]`, pokud byla použita. */
  json: string[] | null;
  line: number;
  endLine: number;
  ignored?: boolean;
}

export interface Diagnostic {
  line: number;
  endLine?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ParsedDockerfile {
  instructions: Instruction[];
  diagnostics: Diagnostic[];
  ok: boolean;
}

export interface BaseInfo {
  supported: boolean;
  flavor?: BaseFlavor;
  name: string;
  tag: string;
}

/** Rozpozná base image podle jména (ignoruje registry a namespace). */
export function classifyBase(ref: string): BaseInfo {
  const noDigest = ref.split('@')[0];
  const lastSlash = noDigest.lastIndexOf('/');
  const colon = noDigest.lastIndexOf(':');
  const hasTag = colon > lastSlash;
  const repo = hasTag ? noDigest.slice(0, colon) : noDigest;
  const tag = hasTag ? noDigest.slice(colon + 1) : 'latest';
  const name = repo.split('/').pop()!.toLowerCase();
  let flavor: BaseFlavor | undefined;
  if (name === 'node') flavor = 'node';
  else if (name === 'nginx' || name === 'nginx-unprivileged') flavor = 'nginx';
  else if (name === 'httpd' || name === 'apache2') flavor = 'httpd';
  return { supported: !!flavor, flavor, name, tag };
}

const PKG_MANAGER_RE = /^(sudo\s+)?(apk|apt-get|apt|yum|dnf|microdnf|zypper|apk-tools|pacman)\b/;

/** Rozdělí RUN příkaz na části, které spustíme, a části se správcem balíčků OS (přeskočí se). */
export function splitRunCommand(cmd: string): { run: string | null; skipped: string[] } {
  const { segments, separators } = splitShellSegments(cmd);
  const skipped: string[] = [];
  let run = '';
  segments.forEach((seg, i) => {
    if (!seg) return;
    if (PKG_MANAGER_RE.test(seg)) {
      skipped.push(seg);
      return;
    }
    if (run) run += ` ${i > 0 ? separators[i - 1] : '&&'} `;
    run += seg;
  });
  return { run: run.trim() || null, skipped };
}

function tryJsonArray(args: string): string[] | null | 'invalid' {
  const t = args.trim();
  if (!t.startsWith('[')) return null;
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
    return 'invalid';
  } catch {
    return 'invalid';
  }
}

/** Odstraní z argumentů COPY/ADD přepínače (--chown, --chmod, --from, --link). */
export function stripFlags(args: string): { flags: Record<string, string>; rest: string } {
  const flags: Record<string, string> = {};
  let rest = args.trim();
  for (;;) {
    const m = rest.match(/^--([a-z-]+)(?:=(\S*))?\s*/);
    if (!m) break;
    flags[m[1]] = m[2] ?? 'true';
    rest = rest.slice(m[0].length);
  }
  return { flags, rest };
}

export function parseDockerfile(text: string, buildArgs: Record<string, string> = {}): ParsedDockerfile {
  const lines = text.split(/\r?\n/);
  const instructions: Instruction[] = [];
  const diagnostics: Diagnostic[] = [];
  const err = (line: number, message: string, endLine?: number) =>
    diagnostics.push({ line, endLine, message, severity: 'error' });
  const warn = (line: number, message: string, endLine?: number) =>
    diagnostics.push({ line, endLine, message, severity: 'warning' });

  // 1) Rozdělení na instrukce (komentáře, pokračování řádku přes `\`)
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) {
      i++;
      continue;
    }
    const startLine = i + 1;
    let endLine = startLine;
    let buf = '';
    let cur = raw;
    for (;;) {
      const t = cur.replace(/\s+$/, '');
      if (t.endsWith('\\')) {
        buf += t.slice(0, -1) + ' ';
        i++;
        while (i < lines.length && (/^\s*#/.test(lines[i]) || !lines[i].trim())) i++;
        if (i >= lines.length) {
          warn(endLine, 'Dockerfile končí znakem „\\“ – chybí pokračování příkazu.');
          break;
        }
        cur = lines[i];
        endLine = i + 1;
        continue;
      }
      buf += t;
      i++;
      break;
    }
    const m = buf.match(/^\s*(\S+)\s*([\s\S]*)$/);
    if (!m) continue;
    const name = m[1].toUpperCase();
    const args = m[2].trim();
    const json = ['RUN', 'CMD', 'ENTRYPOINT', 'COPY', 'ADD'].includes(name) ? tryJsonArray(args) : null;
    if (json === 'invalid') {
      warn(startLine, `${name}: vypadá jako exec forma, ale není to platné JSON pole řetězců – použije se shell forma.`, endLine);
    }
    const ins: Instruction = {
      name,
      args,
      json: json === 'invalid' ? null : json,
      line: startLine,
      endLine,
    };

    if (!(SUPPORTED as readonly string[]).includes(name)) {
      if (IGNORED.includes(name)) {
        ins.ignored = true;
        warn(startLine, `Instrukce ${name} není ve virtuálním Dockeru podporována – bude přeskočena.`, endLine);
      } else {
        err(startLine, `Neznámá instrukce „${m[1]}“. Podporováno: ${SUPPORTED.join(', ')}.`, endLine);
        continue;
      }
    }
    instructions.push(ins);
  }

  // 2) Validace jednotlivých instrukcí
  const argDefaults: Record<string, string> = {};
  const env: Record<string, string> = {};
  let fromCount = 0;
  const vars = () => ({ ...argDefaults, ...buildArgs, ...env });

  if (!instructions.some((x) => x.name === 'FROM')) {
    err(instructions[0]?.line ?? 1, 'Chybí instrukce FROM – Dockerfile musí začínat např. „FROM node:20-alpine“.');
  }

  for (const ins of instructions) {
    const { name, args, line, endLine } = ins;
    if (ins.ignored) continue;

    if (fromCount === 0 && name !== 'FROM' && name !== 'ARG') {
      err(line, `Instrukce ${name} před FROM – před FROM smí být pouze ARG.`, endLine);
      continue;
    }

    const requireArgs = () => {
      if (!args) {
        err(line, `${name} vyžaduje alespoň jeden argument.`, endLine);
        return false;
      }
      return true;
    };

    switch (name) {
      case 'FROM': {
        fromCount++;
        if (!requireArgs()) break;
        if (fromCount > 1) {
          err(line, 'Multi-stage build (více FROM) není ve virtuálním Dockeru podporován.', endLine);
          break;
        }
        const parts = splitArgs(args);
        const image = expandVars(parts[0], vars());
        if (parts.length > 1 && !(parts.length === 3 && parts[1].toUpperCase() === 'AS')) {
          err(line, 'FROM: očekáváno „FROM image[:tag] [AS název]“.', endLine);
        }
        if (/^--platform/.test(parts[0])) {
          warn(line, 'FROM --platform je ignorováno.', endLine);
          break;
        }
        const base = classifyBase(image);
        if (image === 'scratch' || !base.supported) {
          err(
            line,
            `Base image „${image}“ není podporováno ve virtuálním Dockeru. ` +
              'Podporováno: node:* (spouští se nativně), nginx:* a httpd:* (statický server).',
            endLine,
          );
        }
        break;
      }
      case 'WORKDIR':
        requireArgs();
        break;
      case 'COPY':
      case 'ADD': {
        if (!requireArgs()) break;
        const { flags, rest } = stripFlags(args);
        if (flags.from) {
          err(line, `${name} --from není podporováno (multi-stage buildy nejsou k dispozici).`, endLine);
          break;
        }
        const parts = ins.json ?? splitArgs(rest);
        if (parts.length < 2) {
          err(line, `${name} vyžaduje zdroj a cíl, např. „${name} . /app“.`, endLine);
        } else if (parts.length > 2 && !parts[parts.length - 1].endsWith('/')) {
          err(line, `${name} s více zdroji: cíl musí být složka končící „/“.`, endLine);
        }
        if (name === 'ADD' && parts.slice(0, -1).some((p) => /^https?:\/\//.test(p))) {
          warn(line, 'ADD z URL není podporováno – zdroj bude přeskočen.', endLine);
        }
        break;
      }
      case 'RUN': {
        if (!requireArgs()) break;
        const cmd = ins.json ? ins.json.join(' ') : args;
        const { skipped } = splitRunCommand(cmd);
        if (skipped.length) {
          warn(line, `Správce balíčků OS (${skipped.map((s) => s.split(/\s+/)[0]).join(', ')}) není dostupný – tato část bude přeskočena.`, endLine);
        }
        break;
      }
      case 'ENV': {
        if (!requireArgs()) break;
        const kv = parseKeyValues(args);
        if (kv) {
          for (const [k, v] of kv) env[k] = expandVars(v, vars());
        } else {
          const parts = splitArgs(args);
          if (parts.length < 2) err(line, 'ENV: očekáváno „ENV KLÍČ=hodnota“.', endLine);
          else env[parts[0]] = parts.slice(1).join(' ');
        }
        break;
      }
      case 'ARG': {
        if (!requireArgs()) break;
        for (const w of splitArgs(args)) {
          const eq = w.indexOf('=');
          const k = eq < 0 ? w : w.slice(0, eq);
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) err(line, `ARG: neplatný název „${k}“.`, endLine);
          else if (eq >= 0) argDefaults[k] = w.slice(eq + 1);
        }
        break;
      }
      case 'EXPOSE': {
        if (!requireArgs()) break;
        for (const p of splitArgs(expandVars(args, vars()))) {
          if (!/^\d{1,5}(-\d{1,5})?(\/(tcp|udp|sctp))?$/i.test(p) || Number(p.split(/[-/]/)[0]) > 65535) {
            err(line, `EXPOSE: neplatný port „${p}“.`, endLine);
          }
        }
        break;
      }
      case 'CMD':
      case 'ENTRYPOINT':
        requireArgs();
        break;
      case 'LABEL': {
        if (!requireArgs()) break;
        if (!parseKeyValues(args)) err(line, 'LABEL: očekáváno „LABEL klíč=hodnota …“.', endLine);
        break;
      }
    }
  }

  if (!instructions.some((x) => x.name === 'CMD' || x.name === 'ENTRYPOINT')) {
    const from = instructions.find((x) => x.name === 'FROM');
    const base = from ? classifyBase(expandVars(splitArgs(from.args)[0] ?? '', vars())) : null;
    if (base?.flavor === 'node') {
      diagnostics.push({
        line: from!.line,
        message: 'Chybí CMD/ENTRYPOINT – kontejner spustí jen interaktivní `node` (REPL).',
        severity: 'info',
      });
    }
  }

  diagnostics.sort((a, b) => a.line - b.line);
  return { instructions, diagnostics, ok: !diagnostics.some((d) => d.severity === 'error') };
}

/** CMD / ENTRYPOINT → pole argumentů ve formátu Dockeru. */
export function toCommandArray(ins: Instruction): string[] {
  return ins.json ?? ['/bin/sh', '-c', ins.args];
}
