'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dockerStore } from '@/lib/engine';
import { commandStore, endTour, learnStore, startTask, startTour, taskContext } from '@/lib/learn';
import { projectStore } from '@/lib/project';
import { useStore } from '@/lib/store';
import { uiStore } from '@/lib/ui';
import { nextTask } from './LearnPanel';
import { TASKS } from './learnContent';
import { TOUR, type TourContext } from './tourSteps';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 14;
const MARGIN = 12;

/** Poloha cílového prvku; sleduje se každý snímek (panely se mění, terminál jde roztáhnout…). */
function useTargetRect(target: string | undefined): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    let frame = 0;
    let last = '';
    const tick = () => {
      const el = document.querySelector(`[data-tour="${target}"]`);
      const r = el?.getBoundingClientRect();
      const next = r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setRect(next);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return rect;
}

/** Je úkol kroku splněný? Přepočítává se při každé změně stavu aplikace. */
function useTodoDone(step: number | null): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const todo = step === null ? undefined : TOUR[step]?.todo;
    if (!todo) {
      setDone(false);
      return;
    }
    const evaluate = () => {
      const { files, active, template } = projectStore.get();
      const ctx: TourContext = {
        ...taskContext(learnStore.get().tourSince),
        files,
        active,
        template,
        wc: uiStore.get().wc,
      };
      setDone(todo.done(ctx));
    };
    evaluate();
    const offs = [projectStore, dockerStore, commandStore, uiStore].map((s) => s.subscribe(evaluate));
    return () => offs.forEach((off) => off());
  }, [step]);
  return done;
}

/** Umístí kartu vedle zvýrazněného prvku tam, kde je nejvíc místa. */
function placeCard(rect: Rect | null, card: { width: number; height: number }, vw: number, vh: number) {
  const clampTop = (t: number) => Math.min(Math.max(t, MARGIN), vh - card.height - MARGIN);
  const clampLeft = (l: number) => Math.min(Math.max(l, MARGIN), vw - card.width - MARGIN);
  if (!rect) return { top: (vh - card.height) / 2, left: (vw - card.width) / 2 };
  const right = rect.left + rect.width + PAD + GAP;
  const left = rect.left - PAD - GAP - card.width;
  const below = rect.top + rect.height + PAD + GAP;
  const above = rect.top - PAD - GAP - card.height;
  if (below + card.height <= vh - MARGIN && rect.height < vh / 3) return { top: below, left: clampLeft(rect.left) };
  if (right + card.width <= vw - MARGIN) return { top: clampTop(rect.top), left: right };
  if (left >= MARGIN) return { top: clampTop(rect.top), left };
  if (above >= MARGIN) return { top: above, left: clampLeft(rect.left) };
  return { top: vh - card.height - MARGIN, left: clampLeft(rect.left) };
}

export default function Tour() {
  const step = useStore(learnStore, (s) => s.tour);
  const wc = useStore(uiStore, (s) => s.wc);
  const current = step === null ? undefined : TOUR[step];
  const rect = useTargetRect(current?.target);
  const todoDone = useTodoDone(step);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [narrow, setNarrow] = useState(false);

  // Přepnutí panelů, aby byl cíl kroku vidět
  useEffect(() => {
    if (!current) return;
    const patch: Parameters<typeof uiStore.set>[0] = {};
    if (current.rightTab) patch.rightTab = current.rightTab;
    if (current.mobileTab) patch.mobileTab = current.mobileTab;
    uiStore.set(patch);
  }, [current]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isNarrow = vw < 1024;
    setNarrow(isNarrow);
    if (isNarrow) setPos(null);
    else setPos(placeCard(rect, { width: card.offsetWidth, height: card.offsetHeight }, vw, vh));
  }, [rect, step, todoDone, wc]);

  if (step === null || !current) return null;

  const last = step === TOUR.length - 1;
  const blocked = !!current.todo && !todoDone;
  const go = (n: number) => startTour(n);
  const finish = () => {
    endTour();
    const s = learnStore.get();
    learnStore.set({ mode: 'tasks', tutorialDone: true });
    startTask(nextTask(null, s)?.id ?? TASKS[0].id);
    uiStore.set({ rightTab: 'learn', mobileTab: 'docker' });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-live="polite">
      {/* Ztmavení se „průhledem“ na zvýrazněný prvek; aplikace zůstává klikací */}
      {rect ? (
        <div
          className="absolute rounded-lg border-2 border-sky-400 transition-all duration-300"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgb(2 6 23 / 0.62), 0 0 24px rgb(56 189 248 / 0.5)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950/60" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-label={current.title}
        className={`pointer-events-auto absolute rounded-xl border border-sky-500/40 bg-slate-900 p-4 shadow-2xl shadow-black/60 ${
          narrow ? 'inset-x-2 bottom-16' : 'w-[350px]'
        }`}
        style={narrow ? undefined : pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      >
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>
            Prohlídka · {step + 1} / {TOUR.length}
          </span>
          {!last && (
            <button type="button" onClick={finish} className="hover:text-slate-300">
              Ukončit prohlídku ✕
            </button>
          )}
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${((step + 1) / TOUR.length) * 100}%` }} />
        </div>

        <h2 className="mt-3 text-[15px] font-semibold text-slate-100">{current.title}</h2>
        <div className="mt-1.5 max-h-[45vh] space-y-2 overflow-auto text-[13px] leading-relaxed text-slate-300">{current.body}</div>

        {current.todo && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-[13px] ${
              todoDone ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
            }`}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{todoDone ? '✔ Hotovo' : '👉 Tvůj úkol'}</div>
            <div className="mt-0.5">{current.todo.label}</div>
            {!todoDone && current.needsDocker && wc !== 'ready' && (
              <div className="mt-1 text-[12px] text-amber-200/80">
                {wc === 'booting' || wc === 'idle'
                  ? 'Docker se ještě spouští – počkej, až bude kolečko vpravo nahoře zelené.'
                  : 'Docker v tomto prohlížeči neběží, tenhle krok můžeš přeskočit.'}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} className="h-8 rounded-md px-3 text-[13px] text-slate-300 hover:bg-slate-800">
              ← Zpět
            </button>
          )}
          {blocked && (
            <button type="button" onClick={() => go(step + 1)} className="ml-auto h-8 rounded-md px-2 text-[12px] text-slate-500 hover:text-slate-300">
              Přeskočit krok
            </button>
          )}
          <button
            type="button"
            onClick={last ? finish : () => go(step + 1)}
            disabled={blocked}
            className={`${blocked ? '' : 'ml-auto'} h-8 rounded-md border px-4 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
              todoDone ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30' : 'border-sky-500/50 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
            }`}
          >
            {step === 0 ? 'Začít prohlídku →' : last ? 'Začít úkoly 🎯' : 'Další →'}
          </button>
        </div>
      </div>
    </div>
  );
}
