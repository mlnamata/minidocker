'use client';

import { useEffect, useRef, useState } from 'react';
import { dockerStore, engine } from '@/lib/engine';
import { initLearn, learnStore, startTour } from '@/lib/learn';
import { initProject, projectStore, startProjectSync } from '@/lib/project';
import { useStore } from '@/lib/store';
import { openInBrowser, terminalBridge, uiStore, type MobileTab } from '@/lib/ui';
import { bootWebContainer, checkSupport, type SupportInfo } from '@/lib/webcontainer';
import EditorPane from './EditorPane';
import FileExplorer from './FileExplorer';
import { IconBox, IconCode, IconFolder, IconTerminal } from './icons';
import RightPanel from './RightPanel';
import TaskBar from './TaskBar';
import Tour from './Tour';
import TerminalPane from './TerminalPane';
import TopBar from './TopBar';

function StatusBanner({ support }: { support: SupportInfo }) {
  const wc = useStore(uiStore, (s) => s.wc);
  const error = useStore(uiStore, (s) => s.wcError);
  const [hidden, setHidden] = useState(false);

  if ((wc === 'error' || wc === 'unsupported') && error) {
    return (
      <div role="alert" className="shrink-0 border-b border-red-900/60 bg-red-950/60 px-4 py-2.5 text-[13px] text-red-200">
        <b className="font-semibold">Virtuální Docker nelze spustit.</b> {error}
        {wc === 'unsupported' && (
          <span className="block text-red-300/80">
            Editor a průzkumník fungují, ale build a spouštění kontejnerů vyžaduje Chrome/Edge a cross-origin isolated stránku.
          </span>
        )}
      </div>
    );
  }
  if (support.warning && !hidden) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-[13px] text-amber-200">
        <span className="flex-1">{support.warning}</span>
        <button type="button" onClick={() => setHidden(true)} className="rounded px-2 py-0.5 text-amber-300 hover:bg-amber-900/40">
          Zavřít
        </button>
      </div>
    );
  }
  return null;
}

const MOBILE_TABS: Array<{ id: MobileTab; label: string; icon: React.ReactNode }> = [
  { id: 'files', label: 'Soubory', icon: <IconFolder /> },
  { id: 'editor', label: 'Editor', icon: <IconCode /> },
  { id: 'docker', label: 'Docker', icon: <IconBox /> },
  { id: 'terminal', label: 'Terminál', icon: <IconTerminal /> },
];

export default function MiniDocker() {
  const loaded = useStore(projectStore, (s) => s.loaded);
  const mobileTab = useStore(uiStore, (s) => s.mobileTab);
  const [support] = useState(checkSupport);
  const [termHeight, setTermHeight] = useState(270);
  const drag = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    let stopSync: (() => void) | undefined;
    const offOpen = engine.onOpen((url) => openInBrowser(url));
    if (process.env.NODE_ENV !== 'production') {
      // Ladicí přístup z konzole prohlížeče (jen v dev režimu)
      Object.assign(window, { __minidocker: { engine, dockerStore, projectStore, uiStore, learnStore, terminalBridge } });
    }
    (async () => {
      const [, , firstVisit] = await Promise.all([projectStore.get().loaded ? null : initProject(), engine.loadState(), initLearn()]);
      // Při první návštěvě uživatele rovnou provedeme aplikací
      if (firstVisit) startTour(0);
      if (!support.ok) {
        uiStore.set({ wc: 'unsupported', wcError: support.error ?? null });
        engine.fail(new Error(support.error));
        return;
      }
      uiStore.set({ wc: 'booting' });
      try {
        const wc = await bootWebContainer();
        engine.attach(wc);
        stopSync = startProjectSync(wc);
        uiStore.set({ wc: 'ready', wcError: null });
      } catch (e) {
        const message = (e as Error)?.message ?? String(e);
        uiStore.set({ wc: 'error', wcError: message });
        engine.fail(e);
      }
    })();
    return () => {
      offOpen();
      stopSync?.();
    };
  }, [support]);

  if (!loaded) {
    return (
      <div className="flex h-dvh items-center justify-center text-slate-400">
        <span className="mr-3 h-3 w-3 animate-pulse rounded-full bg-sky-400" />
        Načítám projekt…
      </div>
    );
  }

  const show = (tab: MobileTab) => (mobileTab === tab ? 'flex' : 'hidden');

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar />
      <StatusBanner support={support} />
      <TaskBar />

      <div className="flex min-h-0 flex-1 flex-col" style={{ ['--term-h' as string]: `${termHeight}px` }}>
        {/* Horní část: průzkumník | editor | docker panel */}
        <div className={`${mobileTab === 'terminal' ? 'hidden' : 'flex'} min-h-0 flex-1 lg:flex`}>
          <aside data-tour="explorer" className={`${show('files')} min-w-0 flex-1 border-border lg:flex lg:w-60 lg:flex-none lg:border-r`}>
            <FileExplorer />
          </aside>
          <main data-tour="editor" className={`${show('editor')} min-w-0 flex-1 lg:flex`}>
            <EditorPane />
          </main>
          <section data-tour="docker-panel" className={`${show('docker')} min-w-0 flex-1 border-border lg:flex lg:w-[400px] lg:flex-none lg:border-l xl:w-[460px]`}>
            <RightPanel />
          </section>
        </div>

        {/* Táhlo pro změnu výšky terminálu (desktop) */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Změnit výšku terminálu"
          className="hidden h-1.5 shrink-0 cursor-row-resize border-t border-border bg-panel hover:bg-sky-500/40 lg:block"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, h: termHeight };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const next = drag.current.h - (e.clientY - drag.current.y);
            setTermHeight(Math.min(Math.max(next, 120), window.innerHeight - 220));
          }}
          onPointerUp={() => (drag.current = null)}
        />

        {/* Terminál – zůstává namountovaný i na mobilu, jen se skrývá */}
        <section data-tour="terminal" className={`${show('terminal')} min-h-0 flex-1 lg:flex lg:h-[var(--term-h)] lg:flex-none`}>
          <TerminalPane />
        </section>
      </div>

      <Tour />

      {/* Mobilní navigace mezi panely */}
      <nav className="flex shrink-0 border-t border-border bg-panel lg:hidden" aria-label="Panely">
        {MOBILE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => uiStore.set({ mobileTab: t.id })}
            aria-current={mobileTab === t.id}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              mobileTab === t.id ? 'text-sky-300' : 'text-slate-400'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
