/** POSIX path utility (prohlížeč nemá node:path). */

export function normalize(p: string): string {
  const abs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
      continue;
    }
    out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/');
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'));
}

export function dirname(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf('/');
  if (i < 0) return '';
  if (i === 0) return '/';
  return n.slice(0, i);
}

export function basename(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? n : n.slice(i + 1);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i).toLowerCase();
}

/** Absolutní cesta uvnitř image (vždy začíná '/'). */
export function toAbs(p: string, cwd = '/'): string {
  return normalize(p.startsWith('/') ? p : `${cwd}/${p}`) || '/';
}

/** Je `child` uvnitř `parent` (nebo stejný)? Pracuje s normalizovanými cestami. */
export function isInside(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  if (p === '' || p === '/') return true;
  return c === p || c.startsWith(p + '/');
}

/** Relativní cesta projektu (bez úvodního '/' a './'). */
export function projectPath(p: string): string {
  return normalize(p).replace(/^\/+/, '');
}
