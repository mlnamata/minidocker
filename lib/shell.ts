'use client';

import type { Terminal } from '@xterm/xterm';
import { c, stripAnsi } from './ansi';
import { runCommandLine } from './cli';
import type { ForegroundJob } from './cliCommon';
import { engine } from './engine';
import { recordCommand } from './learn';
import { allDirs, projectStore } from './project';
import { KEYS, load, save } from './storage';

const DOCKER_SUBS = ['build', 'compose', 'exec', 'history', 'images', 'inspect', 'logs', 'ps', 'pull', 'restart', 'rm', 'rmi', 'run', 'start', 'stop', 'tag', 'version'];
const COMPOSE_SUBS = ['build', 'config', 'down', 'logs', 'ps', 'restart', 'start', 'stop', 'up'];
const FIRST_WORDS = ['docker', 'clear', 'help', 'cd', 'ls', 'cat', 'node', 'npm', 'pwd', 'jsh'];

/**
 * Jednoduchý shell nad xterm.js: editace řádku, historie (↑/↓), Ctrl+C,
 * doplňování (Tab) a úlohy na popředí (logy -f, interaktivní procesy).
 */
export class Shell {
  private buffer = '';
  private cursor = 0;
  private lastRow = 0;
  private history: string[] = [];
  private histIdx = -1;
  private draft = '';
  private busy = false;
  private fg: ForegroundJob | null = null;
  private abort: AbortController | null = null;
  private idleWaiters: Array<() => void> = [];
  private pendingLines: string[] = [];
  private atLineStart = true;
  cwd = '';

  constructor(private term: Terminal) {}

  async init(): Promise<void> {
    this.history = (await load<string[]>(KEYS.history)) ?? [];
    this.banner();
    this.prompt();
  }

  /* ---------------- výstup ---------------- */

  write = (text: string) => {
    if (!text) return;
    this.term.write(text);
    const plain = stripAnsi(text);
    if (plain) this.atLineStart = plain.endsWith('\n');
  };

  /** Vypíše zprávu „nad“ rozepsaný příkaz (asynchronní hlášky). */
  print(text: string): void {
    const t = text.endsWith('\n') ? text : text + '\n';
    if (this.busy) {
      if (!this.atLineStart) this.write('\n');
      this.write(t);
      return;
    }
    this.clearInputLine();
    this.write(t);
    this.render(true);
  }

  private banner() {
    const lines = [
      c.cyan('   __  ____      _ ___           __'),
      c.cyan('  /  |/  (_)__  (_) _ \\___  ____/ /_____ ____'),
      c.cyan(' / /|_/ / / _ \\/ / // / _ \\/ __/  \'_/ -_) __/'),
      c.cyan('/_/  /_/_/_//_/_/____/\\___/\\__/_/\\_\\\\__/_/'),
      '',
      `${c.bold('MiniDocker')} – virtuální Docker běžící celý ve vašem prohlížeči (WebContainers).`,
      c.gray('Napište „help“ pro seznam příkazů, nebo použijte tlačítka Build / Run / Compose Up nahoře.'),
      '',
    ];
    this.write(lines.join('\n') + '\n');
  }

  private promptText(): string {
    const dir = this.cwd ? `~/${this.cwd}` : '~';
    return `${c.bold(c.brightCyan('minidocker'))}:${c.bold(c.blue(dir))}$ `;
  }

  private promptLen(): number {
    return stripAnsi(this.promptText()).length;
  }

  private prompt() {
    if (!this.atLineStart) this.write('\n');
    this.buffer = '';
    this.cursor = 0;
    this.lastRow = 0;
    this.histIdx = -1;
    this.write(this.promptText());
    this.atLineStart = false;
  }

  private clearInputLine() {
    let s = '';
    if (this.lastRow > 0) s += `\x1b[${this.lastRow}A`;
    s += '\r\x1b[J';
    this.term.write(s);
    this.lastRow = 0;
    this.atLineStart = true;
  }

  /** Překreslí prompt + rozepsaný řádek (zvládá i zalomení přes více řádků). */
  private render(fresh = false) {
    const cols = Math.max(this.term.cols, 10);
    const p = this.promptLen();
    let s = '';
    if (!fresh && this.lastRow > 0) s += `\x1b[${this.lastRow}A`;
    s += '\r\x1b[J' + this.promptText() + this.buffer;
    const endPos = p + this.buffer.length;
    if (endPos > 0 && endPos % cols === 0) s += ' \r';
    const endRow = Math.floor(endPos / cols);
    const curPos = p + this.cursor;
    const curRow = Math.floor(curPos / cols);
    const curCol = curPos % cols;
    if (endRow > curRow) s += `\x1b[${endRow - curRow}A`;
    s += '\r';
    if (curCol > 0) s += `\x1b[${curCol}C`;
    this.lastRow = curRow;
    this.term.write(s);
    this.atLineStart = false;
  }

  /* ---------------- vstup ---------------- */

  handleData = (data: string) => {
    if (this.busy) {
      if (data === '\x03') return this.interrupt();
      if (this.fg?.onData) return this.fg.onData(data);
      if (this.fg?.detachKey && (data === 'd' || data === 'D')) return this.fg.onDetach?.();
      return;
    }

    // Vložení více řádků najednou (paste)
    if (data.length > 1 && /[\r\n]/.test(data) && !data.startsWith('\x1b')) {
      const lines = data.split(/\r\n|\r|\n/);
      const last = lines.pop() ?? '';
      this.insert(lines.shift() ?? '');
      this.pendingLines.push(...lines);
      if (last) this.pendingLines.push(`\u0000${last}`);
      this.submit();
      return;
    }

    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === '\x1b') {
        const m = data.slice(i).match(/^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/);
        if (m) {
          this.escape(m[1]);
          i += m[0].length;
        } else {
          i++;
        }
        continue;
      }
      i++;
      switch (ch) {
        case '\r':
        case '\n':
          this.submit();
          return;
        case '\x7f':
        case '\b':
          if (this.cursor > 0) {
            this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
            this.cursor--;
            this.render();
          }
          break;
        case '\x03':
          this.write('^C');
          this.write('\n');
          this.prompt();
          break;
        case '\x0c':
          this.term.clear();
          this.render(true);
          break;
        case '\x01':
          this.cursor = 0;
          this.render();
          break;
        case '\x05':
          this.cursor = this.buffer.length;
          this.render();
          break;
        case '\x15':
          this.buffer = this.buffer.slice(this.cursor);
          this.cursor = 0;
          this.render();
          break;
        case '\x0b':
          this.buffer = this.buffer.slice(0, this.cursor);
          this.render();
          break;
        case '\x17': {
          const before = this.buffer.slice(0, this.cursor).replace(/\S+\s*$/, '');
          this.buffer = before + this.buffer.slice(this.cursor);
          this.cursor = before.length;
          this.render();
          break;
        }
        case '\t':
          this.complete();
          break;
        default:
          if (ch >= ' ') this.insert(ch);
      }
    }
  };

  private insert(text: string) {
    if (!text) return;
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
    this.cursor += text.length;
    this.render();
  }

  private escape(seq: string) {
    switch (seq) {
      case '[A':
      case 'OA':
        return this.historyNav(-1);
      case '[B':
      case 'OB':
        return this.historyNav(1);
      case '[C':
      case 'OC':
        if (this.cursor < this.buffer.length) this.cursor++;
        return this.render();
      case '[D':
      case 'OD':
        if (this.cursor > 0) this.cursor--;
        return this.render();
      case '[H':
      case 'OH':
      case '[1~':
        this.cursor = 0;
        return this.render();
      case '[F':
      case 'OF':
      case '[4~':
        this.cursor = this.buffer.length;
        return this.render();
      case '[3~':
        if (this.cursor < this.buffer.length) {
          this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
          this.render();
        }
        return;
      case '[1;5C':
      case '[1;3C': {
        const m = this.buffer.slice(this.cursor).match(/^\s*\S+/);
        this.cursor += m ? m[0].length : 0;
        return this.render();
      }
      case '[1;5D':
      case '[1;3D': {
        const m = this.buffer.slice(0, this.cursor).match(/\S+\s*$/);
        this.cursor -= m ? m[0].length : 0;
        return this.render();
      }
    }
  }

  private historyNav(dir: -1 | 1) {
    if (!this.history.length) return;
    if (this.histIdx === -1) {
      if (dir === 1) return;
      this.draft = this.buffer;
      this.histIdx = this.history.length - 1;
    } else {
      this.histIdx += dir;
      if (this.histIdx >= this.history.length) {
        this.histIdx = -1;
        this.buffer = this.draft;
        this.cursor = this.buffer.length;
        return this.render();
      }
      if (this.histIdx < 0) this.histIdx = 0;
    }
    this.buffer = this.history[this.histIdx];
    this.cursor = this.buffer.length;
    this.render();
  }

  private complete() {
    const before = this.buffer.slice(0, this.cursor);
    const words = before.split(/\s+/);
    const cur = words[words.length - 1];
    const prev = words.slice(0, -1).filter(Boolean);
    let candidates: string[];
    if (!prev.length) {
      candidates = FIRST_WORDS;
    } else if (prev[0] === 'docker' && prev.length === 1) {
      candidates = DOCKER_SUBS;
    } else if (prev[0] === 'docker' && prev[1] === 'compose' && prev.length === 2) {
      candidates = COMPOSE_SUBS;
    } else if (prev[0] === 'docker' && ['stop', 'start', 'restart', 'rm', 'logs', 'exec', 'inspect', 'kill'].includes(prev[1])) {
      candidates = engine.containers.map((x) => x.name);
    } else if (prev[0] === 'docker' && ['rmi', 'run', 'history', 'tag'].includes(prev[1])) {
      candidates = engine.images.flatMap((i) => i.repoTags.map((t) => t.replace(/:latest$/, '')));
    } else {
      const st = projectStore.get();
      const base = this.cwd ? this.cwd + '/' : '';
      candidates = [...Object.keys(st.files), ...[...allDirs(st)].map((d) => d + '/')]
        .filter((p) => p.startsWith(base))
        .map((p) => p.slice(base.length));
    }
    const matches = [...new Set(candidates)].filter((x) => x.startsWith(cur));
    if (!matches.length) return;
    if (matches.length === 1) {
      const m = matches[0];
      this.insert(m.slice(cur.length) + (m.endsWith('/') ? '' : ' '));
      return;
    }
    let common = matches[0];
    for (const m of matches) while (!m.startsWith(common)) common = common.slice(0, -1);
    if (common.length > cur.length) {
      this.insert(common.slice(cur.length));
      return;
    }
    this.print(matches.join('  '));
  }

  /* ---------------- spouštění ---------------- */

  private submit() {
    const line = this.buffer;
    // posun kurzoru na konec zalomeného řádku
    this.cursor = this.buffer.length;
    this.render();
    this.write('\n');
    void this.runLine(line);
  }

  /** Spuštění příkazu z UI (tlačítka). Běžící sledování logů se odpojí. */
  async execute(line: string): Promise<number> {
    if (this.busy) {
      if (this.fg?.onDetach) this.fg.onDetach();
      else this.print(c.gray(`⏳ „${line}“ se spustí po dokončení aktuálního příkazu…`));
      await this.whenIdle();
    }
    const saved = this.buffer;
    this.clearInputLine();
    this.write(this.promptText() + line + '\n');
    return this.runLine(line, saved);
  }

  private whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async runLine(line: string, restoreDraft = ''): Promise<number> {
    this.busy = true;
    let code = 0;
    this.abort = new AbortController();
    const trimmed = line.trim();
    if (trimmed && this.history[this.history.length - 1] !== trimmed) {
      this.history.push(trimmed);
      if (this.history.length > 200) this.history.shift();
      void save(KEYS.history, this.history);
    }

    if (trimmed === 'clear' || trimmed === 'cls') {
      this.term.clear();
      this.term.write('\x1b[2J\x1b[H');
      this.atLineStart = true;
    } else if (trimmed) {
      try {
        code = await runCommandLine(trimmed, {
          out: { write: this.write },
          cols: this.term.cols,
          rows: this.term.rows,
          cwd: this.cwd,
          setCwd: (d) => (this.cwd = d),
          signal: this.abort.signal,
          attach: (job) => this.attachJob(job),
        });
      } catch (e) {
        code = 1;
        this.write(c.red(`Chyba: ${(e as Error)?.message ?? e}`) + '\n');
      }
      recordCommand(trimmed, code);
    }

    this.fg = null;
    this.abort = null;
    this.busy = false;
    this.prompt();
    if (restoreDraft) this.insert(restoreDraft);
    const waiters = this.idleWaiters.splice(0);
    waiters.forEach((r) => r());

    const next = this.pendingLines.shift();
    if (next !== undefined) {
      if (next.startsWith('\u0000')) this.insert(next.slice(1));
      else {
        this.insert(next);
        this.submit();
      }
    }
    return code;
  }

  private attachJob(job: ForegroundJob): Promise<void> {
    this.fg = job;
    return Promise.resolve(job.done)
      .catch(() => undefined)
      .then(() => {
        if (this.fg === job) this.fg = null;
      });
  }

  private interrupt() {
    if (this.fg) {
      if (!this.fg.onData) this.write('^C\n');
      this.fg.onInterrupt();
      return;
    }
    if (this.abort && !this.abort.signal.aborted) {
      this.write('^C\n');
      this.abort.abort();
    }
  }

  resize(cols: number, rows: number) {
    this.fg?.onResize?.(cols, rows);
  }
}
