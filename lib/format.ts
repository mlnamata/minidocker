import { stripAnsi } from './ansi';

/** Velikost ve stylu Dockeru: 3 platné číslice, desítkové jednotky (kB, MB, GB). */
export function formatBytes(n: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? Math.round(v) : Number(v.toPrecision(3))}${units[i]}`;
}

/** Doba trvání ve stylu Dockeru (go-units HumanDuration). */
export function humanDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 1) return 'Less than a second';
  if (s === 1) return '1 second';
  if (s < 60) return `${s} seconds`;
  const m = Math.floor(s / 60);
  if (m === 1) return 'About a minute';
  if (m < 60) return `${m} minutes`;
  const h = Math.round(s / 3600);
  if (h === 1) return 'About an hour';
  if (h < 48) return `${h} hours`;
  if (h < 24 * 7 * 2) return `${Math.floor(h / 24)} days`;
  if (h < 24 * 30 * 2) return `${Math.floor(h / 24 / 7)} weeks`;
  if (h < 24 * 365 * 2) return `${Math.floor(h / 24 / 30)} months`;
  return `${Math.floor(h / 24 / 365)} years`;
}

export function timeAgo(ts: number): string {
  return `${humanDuration(Date.now() - ts)} ago`;
}

/** Relativní čas česky pro UI panely. */
export function timeAgoCs(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return 'právě teď';
  if (s < 60) return `před ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `před ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `před ${h} h`;
  return new Date(ts).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
}

/** Tabulka zarovnaná jako výstup `docker ps` (tabwriter, padding 3). */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[i] ?? ''))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? cell : padEnd(cell, widths[i] + 3)))
      .join('')
      .replace(/\s+$/, '');
  return [line(headers), ...rows.map(line)].join('\n') + '\n';
}

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visibleLength(s)));
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'app'
  );
}
