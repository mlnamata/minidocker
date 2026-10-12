/** Parser přepínačů ve stylu docker CLI (`-dit`, `-p8080:80`, `--name=app`, `--env K=V`). */

export interface FlagDef {
  /** Kanonický název (např. 'publish'). */
  name: string;
  short?: string;
  aliases?: string[];
  type: 'bool' | 'value' | 'multi';
}

export interface ParsedFlags {
  flags: Record<string, string | boolean | string[]>;
  positional: string[];
  error?: string;
}

export function parseFlags(args: string[], defs: FlagDef[], opts: { stopAtPositional?: boolean } = {}): ParsedFlags {
  const flags: ParsedFlags['flags'] = {};
  const positional: string[] = [];
  const byLong = new Map<string, FlagDef>();
  const byShort = new Map<string, FlagDef>();
  for (const d of defs) {
    byLong.set(d.name, d);
    for (const a of d.aliases ?? []) byLong.set(a, d);
    if (d.short) byShort.set(d.short, d);
  }
  const setFlag = (d: FlagDef, value: string | boolean) => {
    if (d.type === 'multi') {
      const arr = (flags[d.name] as string[] | undefined) ?? [];
      arr.push(String(value));
      flags[d.name] = arr;
    } else {
      flags[d.name] = value;
    }
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const d = byLong.get(key);
      if (!d) return { flags, positional, error: `unknown flag: --${key}` };
      if (d.type === 'bool') {
        setFlag(d, eq < 0 ? true : a.slice(eq + 1) !== 'false');
      } else {
        const v = eq < 0 ? args[++i] : a.slice(eq + 1);
        if (v === undefined) return { flags, positional, error: `flag needs an argument: --${key}` };
        setFlag(d, v);
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        const d = byShort.get(ch);
        if (!d) return { flags, positional, error: `unknown shorthand flag: '${ch}' in ${a}` };
        if (d.type === 'bool') {
          setFlag(d, true);
          continue;
        }
        let v = a.slice(j + 1);
        if (v.startsWith('=')) v = v.slice(1);
        if (!v) v = args[++i];
        if (v === undefined) return { flags, positional, error: `flag needs an argument: '${ch}' in ${a}` };
        setFlag(d, v);
        break;
      }
      continue;
    }
    if (opts.stopAtPositional) {
      positional.push(...args.slice(i));
      break;
    }
    positional.push(a);
  }
  return { flags, positional };
}

export const bool = (f: ParsedFlags['flags'], k: string) => f[k] === true;
export const str = (f: ParsedFlags['flags'], k: string) => (typeof f[k] === 'string' ? (f[k] as string) : undefined);
export const list = (f: ParsedFlags['flags'], k: string) => (Array.isArray(f[k]) ? (f[k] as string[]) : []);
