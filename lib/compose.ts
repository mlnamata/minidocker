import yaml from 'js-yaml';
import { join } from './paths';
import { expandVars, splitArgs } from './shellwords';
import type { PortMapping } from './types';

export interface ComposeService {
  name: string;
  build?: { context: string; dockerfile: string; args: Record<string, string> };
  image?: string;
  ports: PortMapping[];
  expose: number[];
  environment: Record<string, string>;
  command?: string[];
  entrypoint?: string[];
  dependsOn: string[];
  volumes: string[];
  containerName?: string;
}

export interface ComposeProject {
  name: string;
  file: string;
  /** Složka compose souboru (relativně k projektu). */
  dir: string;
  services: Record<string, ComposeService>;
  /** Pořadí startu podle depends_on. */
  order: string[];
}

export interface ComposeIssue {
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}

export const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

export function isComposeFile(path: string): boolean {
  const b = path.split('/').pop() ?? '';
  return COMPOSE_FILES.includes(b) || /^(docker-)?compose\.[\w.-]+\.ya?ml$/.test(b);
}

/** Najde řádek s klíčem služby (pro podtržení chyby v editoru). */
function findLine(text: string, key: string): number | undefined {
  const lines = text.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  const idx = lines.findIndex((l) => re.test(l));
  return idx >= 0 ? idx + 1 : undefined;
}

export function parsePort(spec: unknown): PortMapping | null {
  if (typeof spec === 'number') return { host: spec, container: spec };
  if (spec && typeof spec === 'object') {
    const o = spec as { target?: number; published?: number | string; host_ip?: string };
    if (!o.target) return null;
    return { container: Number(o.target), host: Number(o.published ?? o.target), hostIp: o.host_ip };
  }
  if (typeof spec !== 'string') return null;
  const s = spec.replace(/\/(tcp|udp|sctp)$/i, '');
  const parts = s.split(':');
  const nums = parts.map((p) => Number(p));
  if (parts.length === 1 && nums[0] > 0) return { host: 0, container: nums[0] };
  if (parts.length === 2 && nums[0] > 0 && nums[1] > 0) return { host: nums[0], container: nums[1] };
  if (parts.length === 3 && nums[1] > 0 && nums[2] > 0) return { hostIp: parts[0], host: nums[1], container: nums[2] };
  return null;
}

function toEnv(v: unknown, vars: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = String(item);
      const eq = s.indexOf('=');
      if (eq < 0) env[s] = vars[s] ?? '';
      else env[s.slice(0, eq)] = s.slice(eq + 1);
    }
  } else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) env[k] = val == null ? vars[k] ?? '' : String(val);
  }
  return env;
}

function toCommand(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  return splitArgs(String(v));
}

/** Topologické řazení podle depends_on. Při cyklu vyhodí chybu s cestou cyklu. */
export function topoSort(services: Record<string, { dependsOn: string[] }>): string[] {
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string, path: string[]) => {
    const st = state.get(name);
    if (st === 'done') return;
    if (st === 'visiting') {
      const cycle = [...path.slice(path.indexOf(name)), name];
      throw new Error(`dependency cycle detected: ${cycle.join(' -> ')}`);
    }
    state.set(name, 'visiting');
    for (const dep of services[name].dependsOn) visit(dep, [...path, name]);
    state.set(name, 'done');
    order.push(name);
  };
  for (const name of Object.keys(services).sort()) visit(name, []);
  return order;
}

export function parseCompose(
  text: string,
  opts: { file: string; projectName: string; dotenv?: Record<string, string> },
): { project?: ComposeProject; issues: ComposeIssue[] } {
  const issues: ComposeIssue[] = [];
  const vars = opts.dotenv ?? {};
  let doc: unknown;
  try {
    doc = yaml.load(expandVars(text, vars));
  } catch (e) {
    const ye = e as { mark?: { line: number }; reason?: string; message: string };
    issues.push({
      line: ye.mark ? ye.mark.line + 1 : undefined,
      message: `Chyba YAML: ${ye.reason ?? ye.message}`,
      severity: 'error',
    });
    return { issues };
  }

  if (!doc || typeof doc !== 'object' || !('services' in doc)) {
    issues.push({ line: 1, message: 'Compose soubor musí obsahovat klíč „services“.', severity: 'error' });
    return { issues };
  }
  const root = doc as { name?: string; services: unknown; version?: unknown };
  if (root.version !== undefined) {
    issues.push({ line: findLine(text, 'version'), message: '`version` je zastaralé a ignoruje se.', severity: 'warning' });
  }
  if (!root.services || typeof root.services !== 'object' || Array.isArray(root.services)) {
    issues.push({ line: findLine(text, 'services'), message: '„services“ musí být mapa služeb.', severity: 'error' });
    return { issues };
  }

  const dir = opts.file.includes('/') ? opts.file.slice(0, opts.file.lastIndexOf('/')) : '';
  const services: Record<string, ComposeService> = {};

  for (const [name, rawSvc] of Object.entries(root.services as Record<string, unknown>)) {
    const line = findLine(text, name);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      issues.push({ line, message: `Neplatný název služby „${name}“.`, severity: 'error' });
      continue;
    }
    const s = (rawSvc ?? {}) as Record<string, unknown>;
    const svc: ComposeService = {
      name,
      ports: [],
      expose: [],
      environment: toEnv(s.environment, vars),
      command: toCommand(s.command),
      entrypoint: toCommand(s.entrypoint),
      dependsOn: [],
      volumes: Array.isArray(s.volumes) ? s.volumes.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))) : [],
      containerName: typeof s.container_name === 'string' ? s.container_name : undefined,
    };

    if (typeof s.build === 'string') {
      svc.build = { context: join(dir, s.build), dockerfile: 'Dockerfile', args: {} };
    } else if (s.build && typeof s.build === 'object') {
      const b = s.build as { context?: string; dockerfile?: string; args?: unknown };
      svc.build = {
        context: join(dir, b.context ?? '.'),
        dockerfile: b.dockerfile ?? 'Dockerfile',
        args: toEnv(b.args, vars),
      };
    }
    if (typeof s.image === 'string') svc.image = s.image;
    if (!svc.build && !svc.image) {
      issues.push({ line, message: `Služba „${name}“ musí mít „build“ nebo „image“.`, severity: 'error' });
    }

    if (s.ports !== undefined) {
      if (!Array.isArray(s.ports)) {
        issues.push({ line: line, message: `Služba „${name}“: ports musí být seznam.`, severity: 'error' });
      } else {
        for (const p of s.ports) {
          const pm = parsePort(p);
          if (pm) svc.ports.push(pm);
          else issues.push({ line, message: `Služba „${name}“: neplatné mapování portu „${String(p)}“.`, severity: 'error' });
        }
      }
    }
    if (Array.isArray(s.expose)) svc.expose = s.expose.map((p) => parseInt(String(p), 10)).filter((n) => n > 0);

    if (Array.isArray(s.depends_on)) svc.dependsOn = s.depends_on.map(String);
    else if (s.depends_on && typeof s.depends_on === 'object') svc.dependsOn = Object.keys(s.depends_on);

    if (svc.volumes.length) {
      issues.push({
        line: findLine(text, 'volumes'),
        message: `Služba „${name}“: volumes jsou ve virtuálním Dockeru jen informativní.`,
        severity: 'warning',
      });
    }
    services[name] = svc;
  }

  for (const svc of Object.values(services)) {
    for (const dep of svc.dependsOn) {
      if (!services[dep]) {
        issues.push({
          line: findLine(text, svc.name),
          message: `Služba „${svc.name}“ závisí na neexistující službě „${dep}“.`,
          severity: 'error',
        });
      }
    }
  }
  if (issues.some((i) => i.severity === 'error')) return { issues };

  let order: string[];
  try {
    order = topoSort(services);
  } catch (e) {
    issues.push({ line: findLine(text, 'depends_on'), message: (e as Error).message, severity: 'error' });
    return { issues };
  }

  const name = typeof root.name === 'string' && root.name ? root.name : opts.projectName;
  return {
    project: { name: name.toLowerCase().replace(/[^a-z0-9_-]/g, ''), file: opts.file, dir, services, order },
    issues,
  };
}

/** Jednoduchý parser .env souboru pro interpolaci ${VAR} v compose. */
export function parseDotenv(text: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  if (!text) return env;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
