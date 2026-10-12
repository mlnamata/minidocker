/**
 * Rozdělení příkazové řádky na argumenty (uvozovky, escapování backslashem).
 * Používá se pro terminál, Dockerfile (ENV/LABEL/COPY) i compose `command`.
 */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
        cur += line[++i];
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === '\\' && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) {
        out.push(cur);
        cur = '';
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** Je řetězec "jednoduchý" příkaz bez shellových konstrukcí? (pak ho lze spustit přímo) */
export function isSimpleCommand(cmd: string): boolean {
  return !/[|&;<>()$`*?{}[\]~\n]/.test(cmd);
}

/** Uvozovky pro zobrazení argumentu (např. v `docker ps` COMMAND). */
export function quoteArg(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * Rozdělí shellový příkaz na segmenty podle `&&`, `||` a `;` (mimo uvozovky).
 * Vrací segmenty i oddělovače, aby šel příkaz po úpravě znovu složit.
 */
export function splitShellSegments(cmd: string): { segments: string[]; separators: string[] } {
  const segments: string[] = [];
  const separators: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '\\' && i + 1 < cmd.length) {
      cur += ch + cmd[++i];
    } else if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) {
      segments.push(cur.trim());
      separators.push(ch + ch);
      cur = '';
      i++;
    } else if (ch === ';') {
      segments.push(cur.trim());
      separators.push(';');
      cur = '';
    } else {
      cur += ch;
    }
  }
  segments.push(cur.trim());
  return { segments, separators };
}

/**
 * Expanze proměnných `$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR:+alt}`.
 * Uvnitř jednoduchých uvozovek se neexpanduje, `\$` je literál.
 */
export function expandVars(input: string, env: Record<string, string | undefined>): string {
  let out = '';
  let single = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'") {
      single = !single;
      out += ch;
      continue;
    }
    if (ch === '\\' && input[i + 1] === '$') {
      out += '\\$';
      i++;
      continue;
    }
    if (ch !== '$' || single) {
      out += ch;
      continue;
    }
    if (input[i + 1] === '{') {
      const end = input.indexOf('}', i + 2);
      if (end < 0) {
        out += ch;
        continue;
      }
      const expr = input.slice(i + 2, end);
      const m = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::?([-+])(.*))?$/s);
      if (!m) {
        out += input.slice(i, end + 1);
      } else {
        const val = env[m[1]];
        if (m[2] === '-') out += val ? val : m[3];
        else if (m[2] === '+') out += val ? m[3] : '';
        else out += val ?? '';
      }
      i = end;
      continue;
    }
    const m = input.slice(i + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!m) {
      out += ch;
      continue;
    }
    out += env[m[0]] ?? '';
    i += m[0].length;
  }
  return out;
}

/** Parsování `KEY=value KEY2="a b"` (ENV, LABEL). Vrací null, pokud token neobsahuje '='. */
export function parseKeyValues(args: string): Array<[string, string]> | null {
  const words = splitArgs(args);
  const pairs: Array<[string, string]> = [];
  for (const w of words) {
    const eq = w.indexOf('=');
    if (eq <= 0) return null;
    pairs.push([w.slice(0, eq), w.slice(eq + 1)]);
  }
  return pairs;
}
