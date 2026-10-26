'use client';

import { useEffect } from 'react';
import { dockerStore } from '@/lib/engine';
import { commandStore, completeTask, learnStore, startTask, taskContext } from '@/lib/learn';
import { projectStore } from '@/lib/project';
import { useStore } from '@/lib/store';
import { uiStore } from '@/lib/ui';
import { IconCap } from './icons';
import { nextTask } from './LearnPanel';
import { TASKS } from './learnContent';

/** Automatická kontrola aktuálního úkolu při každé změně stavu aplikace. */
function useTaskWatcher() {
  useEffect(() => {
    let queued = false;
    const evaluate = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const s = learnStore.get();
        if (!s.loaded || !s.current || s.done.includes(s.current)) return;
        const task = TASKS.find((t) => t.id === s.current);
        if (!task?.check) return;
        try {
          if (task.check(taskContext(s.currentSince))) completeTask(task.id);
        } catch (e) {
          console.warn('[learn] kontrola úkolu selhala', e);
        }
      });
    };
    const offs = [dockerStore, projectStore, commandStore, learnStore].map((st) => st.subscribe(evaluate));
    evaluate();
    return () => offs.forEach((off) => off());
  }, []);
}

/** Pomalé blikání prvku, na který ukazuje tutoriál. */
function useTourHighlight() {
  // Během prohlídky zvýrazňuje sama prohlídka
  const id = useStore(learnStore, (s) => (s.tour === null ? s.highlight : null));
  useEffect(() => {
    if (!id) return;
    const els = document.querySelectorAll(`[data-tour="${id}"]`);
    els.forEach((el) => el.classList.add('tour-highlight'));
    return () => els.forEach((el) => el.classList.remove('tour-highlight'));
  }, [id]);
}

const openLearn = () => uiStore.set({ rightTab: 'learn', mobileTab: 'docker' });

/** Lišta s aktuálním úkolem pod horní lištou – je vidět, ať je otevřená jakákoli záložka. */
export default function TaskBar() {
  useTaskWatcher();
  useTourHighlight();
  const s = useStore(learnStore, (x) => x);
  const rightTab = useStore(uiStore, (x) => x.rightTab);

  if (!s.loaded || s.mode !== 'tasks' || !s.current) return null;
  const index = TASKS.findIndex((t) => t.id === s.current);
  const task = TASKS[index];
  if (!task) return null;
  const done = s.done.includes(task.id);
  const next = done ? nextTask(task.id, s) : undefined;

  return (
    <div
      className={`flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[12px] ${
        done ? 'border-emerald-900/60 bg-emerald-950/50 text-emerald-100' : 'border-sky-900/50 bg-sky-950/40 text-sky-100'
      }`}
      role="status"
    >
      <IconCap width={14} height={14} className={`shrink-0 ${done ? 'text-emerald-300' : 'text-sky-300'}`} />
      <span className="shrink-0 font-semibold">
        Úkol {index + 1}/{TASKS.length}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {task.title}
        {done && <b className="ml-2 text-emerald-300">✔ Splněno!</b>}
      </span>
      {done && next && next.id !== task.id ? (
        <button
          type="button"
          onClick={() => {
            startTask(next.id);
            openLearn();
          }}
          className="shrink-0 rounded border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-200 hover:bg-emerald-500/25"
        >
          Další úkol →
        </button>
      ) : (
        rightTab !== 'learn' && (
          <button type="button" onClick={openLearn} className="shrink-0 rounded border border-sky-400/30 px-2 py-0.5 text-sky-200 hover:bg-sky-500/15">
            Zadání
          </button>
        )
      )}
    </div>
  );
}
