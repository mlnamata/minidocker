const wrap = (code: string) => (s: string | number) => `\x1b[${code}m${s}\x1b[0m`;

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
  brightBlue: wrap('94'),
  brightCyan: wrap('96'),
};

/** Barvy prefixů služeb v `docker compose` (stejně jako compose cykluje barvy). */
const SERVICE_COLORS = ['36', '33', '32', '35', '34', '96', '93', '92', '95', '94'];

export function serviceColor(index: number): (s: string) => string {
  return wrap(SERVICE_COLORS[index % SERVICE_COLORS.length]);
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g, '');
}
