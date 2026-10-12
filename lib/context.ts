import { basename, isInside, projectPath } from './paths';

/** Glob → RegExp (podporuje `*`, `**`, `?`, `[abc]`). */
export function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end > i) {
        re += '[' + glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
        i = end;
      } else {
        re += '\\[';
      }
    } else {
      re += ch.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export const hasGlob = (p: string) => /[*?[]/.test(p);

function parentDirs(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/** Odfiltruje soubory podle .dockerignore (pravidla s `!` vrací soubory zpět). */
export function applyDockerignore(files: string[], ignoreText: string | undefined): string[] {
  if (!ignoreText) return files;
  const rules = ignoreText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const neg = l.startsWith('!');
      return { neg, re: globToRegex(projectPath(neg ? l.slice(1).trim() : l)) };
    });
  return files.filter((f) => {
    const candidates = [f, ...parentDirs(f)];
    let excluded = false;
    for (const r of rules) {
      if (candidates.some((cand) => r.re.test(cand))) excluded = !r.neg;
    }
    return !excluded;
  });
}

/** Soubory build kontextu: cesty relativní ke kontextu, po aplikaci .dockerignore. */
export function contextFiles(files: Record<string, string>, contextDir: string): Record<string, string> {
  const dir = projectPath(contextDir);
  const rel: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!isInside(path, dir)) continue;
    rel[dir ? path.slice(dir.length + 1) : path] = content;
  }
  const kept = applyDockerignore(Object.keys(rel), rel['.dockerignore']);
  const out: Record<string, string> = {};
  for (const k of kept.sort()) out[k] = rel[k];
  return out;
}

export interface CopyFile {
  /** Cesta v kontextu. */
  src: string;
  /** Cesta relativně k cílové složce. */
  rel: string;
}

export interface ResolvedCopy {
  files: CopyFile[];
  /** Cíl je určitě složka (víc zdrojů, složka nebo glob). */
  forceDir: boolean;
  missing: string[];
}

/** Vyhodnotí zdroje COPY/ADD proti souborům kontextu (podpora `.`, složek a globů). */
export function resolveCopySources(sources: string[], ctx: string[]): ResolvedCopy {
  const files: CopyFile[] = [];
  const missing: string[] = [];
  let forceDir = sources.length > 1;
  const set = new Set(ctx);

  const addDir = (dir: string) => {
    for (const f of ctx) {
      if (dir === '' || f.startsWith(dir + '/')) files.push({ src: f, rel: dir ? f.slice(dir.length + 1) : f });
    }
  };

  for (const raw of sources) {
    const p = projectPath(raw);
    if (p === '' || p === '.') {
      addDir('');
      forceDir = true;
    } else if (set.has(p)) {
      files.push({ src: p, rel: basename(p) });
    } else if (ctx.some((f) => f.startsWith(p + '/'))) {
      addDir(p);
      forceDir = true;
    } else if (hasGlob(p)) {
      const re = globToRegex(p);
      const matched = ctx.filter((f) => re.test(f));
      const dirs = new Set<string>();
      for (const f of ctx) for (const d of parentDirs(f)) if (re.test(d)) dirs.add(d);
      for (const f of matched) files.push({ src: f, rel: basename(f) });
      for (const d of dirs) {
        for (const f of ctx) if (f.startsWith(d + '/')) files.push({ src: f, rel: f.slice(d.length + 1) });
      }
      if (!matched.length && !dirs.size) missing.push(raw);
      if (matched.length + dirs.size > 1 || dirs.size) forceDir = true;
    } else {
      missing.push(raw);
    }
  }
  return { files, forceDir, missing };
}
