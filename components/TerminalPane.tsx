'use client';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { c } from '@/lib/ansi';
import { Shell } from '@/lib/shell';
import { terminalBridge, uiStore, type WcStatus } from '@/lib/ui';
import { IconTerminal } from './icons';

export default function TerminalPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<Shell | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: {
        background: '#0a0e1a',
        foreground: '#d6deeb',
        cursor: '#38bdf8',
        selectionBackground: '#1e3a5f',
        black: '#1e293b',
        brightBlack: '#64748b',
        blue: '#60a5fa',
        brightBlue: '#93c5fd',
        cyan: '#22d3ee',
        brightCyan: '#67e8f9',
        green: '#4ade80',
        brightGreen: '#86efac',
        yellow: '#facc15',
        brightYellow: '#fde047',
        red: '#f87171',
        brightRed: '#fca5a5',
        magenta: '#c084fc',
        brightMagenta: '#d8b4fe',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const shell = new Shell(term);
    shellRef.current = shell;
    const dataSub = term.onData(shell.handleData);

    const doFit = () => {
      if (!host.offsetWidth || !host.offsetHeight) return;
      try {
        fit.fit();
        shell.resize(term.cols, term.rows);
      } catch {
        /* skrytý panel */
      }
    };
    const ro = new ResizeObserver(() => requestAnimationFrame(doFit));
    ro.observe(host);
    doFit();

    terminalBridge.run = (cmd) => shell.execute(cmd);
    if (process.env.NODE_ENV !== 'production') {
      // Ladění: čtení bufferu terminálu z konzole (jen dev)
      Object.assign(window, {
        __minidockerTerm: () => {
          const buf = term.buffer.active;
          const lines: string[] = [];
          for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
          return lines.join('\n').trimEnd();
        },
      });
    }
    terminalBridge.print = (text) => shell.print(text);

    // Stav WebContaineru vypisujeme i do terminálu
    let lastStatus: WcStatus | null = null;
    const report = () => {
      const { wc, wcError } = uiStore.get();
      if (wc === lastStatus) return;
      lastStatus = wc;
      if (wc === 'booting') shell.print(c.gray('⏳ Spouštím WebContainer (Node.js v prohlížeči)…'));
      if (wc === 'ready') shell.print(c.green('✔ WebContainer běží – můžete stavět a spouštět kontejnery.'));
      if (wc === 'error' || wc === 'unsupported') {
        shell.print(c.red(`✖ WebContainer nelze spustit: ${wcError ?? 'neznámá chyba'}`));
        shell.print(c.yellow('  Editor a průzkumník fungují dál, docker příkazy ale nepůjdou spustit.'));
      }
    };
    let unsub = () => {};
    let disposed = false;
    void shell.init().then(() => {
      if (disposed) return;
      report();
      unsub = uiStore.subscribe(report);
    });

    return () => {
      disposed = true;
      unsub();
      ro.disconnect();
      dataSub.dispose();
      terminalBridge.run = async () => 1;
      terminalBridge.print = () => undefined;
      term.dispose();
      shellRef.current = null;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#0a0e1a]">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
        <IconTerminal width={14} height={14} className="text-slate-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Terminál</span>
        <span className="hidden truncate text-[11px] text-slate-500 md:inline">
          docker CLI · Ctrl+C přeruší · ↑/↓ historie · Tab doplní · ostatní příkazy běží v jsh
        </span>
        <button
          type="button"
          onClick={() => void terminalBridge.run('clear')}
          className="ml-auto rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          Vyčistit
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" onClick={() => shellRef.current && hostRef.current?.querySelector('textarea')?.focus()} />
    </div>
  );
}
