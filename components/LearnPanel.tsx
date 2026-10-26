'use client';

import { useEffect, useState } from 'react';
import {
  completeTask,
  learnStore,
  resetLearn,
  revealHint,
  setHighlight,
  skipTask,
  startTask,
  startTour,
  taskContext,
  type LearnState,
} from '@/lib/learn';
import { useStore } from '@/lib/store';
import { IconCap, IconCheck, IconLock } from './icons';
import { TASKS, TUTORIAL, type Task } from './learnContent';

/** Úkol je odemčený, když jsou všechny předchozí splněné nebo přeskočené. */
export function isUnlocked(index: number, s: Pick<LearnState, 'done' | 'skipped'>): boolean {
  return TASKS.slice(0, index).every((t) => s.done.includes(t.id) || s.skipped.includes(t.id));
}

/** Další úkol, který ještě není splněný. */
export function nextTask(after: string | null, s: Pick<LearnState, 'done'>): Task | undefined {
  const from = after ? TASKS.findIndex((t) => t.id === after) + 1 : 0;
  return TASKS.slice(from).find((t) => !s.done.includes(t.id)) ?? TASKS.find((t) => !s.done.includes(t.id));
}

/* ---------------- Příručka ---------------- */

function TutorialView() {
  const step = useStore(learnStore, (s) => s.tutorialStep);
  const i = Math.min(Math.max(step, 0), TUTORIAL.length - 1);
  const current = TUTORIAL[i];
  const last = i === TUTORIAL.length - 1;

  useEffect(() => {
    setHighlight(current.target ?? null);
    return () => setHighlight(null);
  }, [current]);

  const go = (n: number) => {
    learnStore.set({ tutorialStep: n });
    document.getElementById('learn-scroll')?.scrollTo({ top: 0 });
  };

  const finish = () => {
    const s = learnStore.get();
    learnStore.set({ tutorialDone: true });
    startTask(s.current ?? nextTask(null, s)?.id ?? TASKS[0].id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-3">
        <button
          type="button"
          onClick={() => startTour(0)}
          className="mb-3 flex w-full items-center gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-left hover:bg-sky-500/20"
        >
          <span className="text-lg">🧭</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-sky-100">Prohlídka aplikace</span>
            <span className="block text-[11px] text-sky-200/70">Provede tě krok za krokem vším, co MiniDocker umí.</span>
          </span>
          <span className="text-[12px] font-medium text-sky-200">Spustit ▶</span>
        </button>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>
            Příručka · {i + 1} / {TUTORIAL.length}
          </span>
          <button type="button" onClick={finish} className="hover:text-slate-300">
            Přeskočit na úkoly →
          </button>
        </div>
        <div className="mt-1.5 flex gap-1">
          {TUTORIAL.map((t, n) => (
            <button
              key={t.title}
              type="button"
              onClick={() => go(n)}
              title={t.title}
              aria-label={`Krok ${n + 1}: ${t.title}`}
              className={`h-1.5 flex-1 rounded-full ${n <= i ? 'bg-sky-400' : 'bg-slate-700 hover:bg-slate-600'}`}
            />
          ))}
        </div>
      </div>
      <div id="learn-scroll" className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <h2 className="mb-2 text-[15px] font-semibold text-slate-100">{current.title}</h2>
        <div className="space-y-2 text-[13px] leading-relaxed text-slate-300">{current.body}</div>
        {current.target && (
          <p className="mt-3 hidden text-[11px] text-sky-300/80 lg:block">Zvýrazněná část aplikace bliká modře.</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="h-8 rounded-md px-3 text-[13px] text-slate-300 hover:bg-slate-800 disabled:opacity-30"
        >
          ← Zpět
        </button>
        <button
          type="button"
          onClick={last ? finish : () => go(i + 1)}
          className="ml-auto h-8 rounded-md border border-sky-500/50 bg-sky-500/15 px-4 text-[13px] font-medium text-sky-200 hover:bg-sky-500/25"
        >
          {last ? 'Začít úkoly 🎯' : 'Další →'}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Úkoly ---------------- */

const LEVELS = { 1: 'lehký', 2: 'střední', 3: 'těžký' } as const;
const LEVEL_TONE = {
  1: 'bg-emerald-500/10 text-emerald-300',
  2: 'bg-amber-500/10 text-amber-300',
  3: 'bg-rose-500/10 text-rose-300',
} as const;

function AnswerForm({ task }: { task: Task }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const since = useStore(learnStore, (s) => s.currentSince);
  const a = task.answer!;
  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const res = a.verify(value, taskContext(since));
        if (res === true) {
          setError(null);
          completeTask(task.id);
        } else setError(res);
      }}
    >
      <label className="text-[11px] font-medium text-slate-400">{a.label}</label>
      <div className="mt-1 flex gap-1.5">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          autoComplete="off"
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-[13px] text-slate-100"
        />
        <button type="submit" className="h-8 shrink-0 rounded-md border border-sky-500/50 bg-sky-500/15 px-3 text-[13px] font-medium text-sky-200 hover:bg-sky-500/25">
          Zkontrolovat
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-red-300">✖ {error}</p>}
    </form>
  );
}

function TaskDetail({ task, index }: { task: Task; index: number }) {
  const done = useStore(learnStore, (s) => s.done.includes(task.id));
  const shown = useStore(learnStore, (s) => s.hints[task.id] ?? 0);
  const state = useStore(learnStore, (s) => s);
  const next = nextTask(task.id, state);

  return (
    <div className="border-t border-slate-800 px-3 pb-3 pt-2">
      <div className="space-y-2 text-[13px] leading-relaxed text-slate-300">{task.goal}</div>

      {done ? (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-100">
          <p className="font-semibold text-emerald-300">✔ Splněno!</p>
          {task.learned && <p className="mt-1">{task.learned}</p>}
          {next && next.id !== task.id && (
            <button
              type="button"
              onClick={() => startTask(next.id)}
              className="mt-2 h-7 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-3 text-[12px] font-medium text-emerald-200 hover:bg-emerald-500/25"
            >
              Další úkol: {next.title} →
            </button>
          )}
        </div>
      ) : (
        <>
          {task.answer ? (
            <AnswerForm task={task} />
          ) : (
            <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
              Kontroluje se automaticky – stačí úkol splnit.
            </p>
          )}

          {shown > 0 && (
            <ol className="mt-3 space-y-1.5">
              {task.hints.slice(0, shown).map((h, n) => (
                <li key={n} className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-100/90">
                  <span className="mr-1 font-semibold text-amber-300">Nápověda {n + 1}:</span>
                  {h}
                </li>
              ))}
            </ol>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {shown < task.hints.length && (
              <button
                type="button"
                onClick={() => revealHint(task.id)}
                className="h-7 rounded-md border border-amber-500/30 px-2.5 text-[12px] text-amber-200 hover:bg-amber-500/10"
              >
                💡 Nápověda ({shown + 1}/{task.hints.length})
              </button>
            )}
            {index < TASKS.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm('Přeskočit úkol? Bude označený jako nesplněný a můžeš se k němu kdykoli vrátit.')) return;
                  skipTask(task.id);
                  const n = nextTask(task.id, learnStore.get());
                  if (n) startTask(n.id);
                }}
                className="ml-auto h-7 rounded-md px-2.5 text-[12px] text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                Přeskočit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TasksView() {
  const s = useStore(learnStore, (x) => x);
  const doneCount = TASKS.filter((t) => s.done.includes(t.id)).length;
  const all = doneCount === TASKS.length;

  // Při prvním otevření úkolů vybereme první nesplněný
  useEffect(() => {
    if (!s.current) {
      const n = nextTask(null, s);
      if (n) startTask(n.id);
    }
  }, [s]);

  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-slate-400">
            Splněno <b className="text-slate-100">{doneCount}</b> z {TASKS.length}
          </span>
          <button
            type="button"
            onClick={() => window.confirm('Začít výuku od začátku? Postup v úkolech se smaže.') && resetLearn()}
            className="text-[11px] text-slate-500 hover:text-slate-300"
          >
            Začít znovu
          </button>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(doneCount / TASKS.length) * 100}%` }} />
        </div>
        {all && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-100">
            🏆 <b>Všechny úkoly splněné!</b> Teď už umíš Docker základy: Dockerfile, build, run, porty, proměnné, logy, exec
            i Compose. Projekt si můžeš stáhnout přes Export ZIP a spustit ve skutečném Dockeru.
          </div>
        )}
      </div>
      <ol className="space-y-2 p-3">
        {TASKS.map((task, i) => {
          const done = s.done.includes(task.id);
          const skipped = s.skipped.includes(task.id);
          const unlocked = isUnlocked(i, s);
          const open = s.current === task.id;
          return (
            <li
              key={task.id}
              className={`overflow-hidden rounded-lg border ${open ? 'border-sky-500/50 bg-slate-900' : 'border-border bg-slate-900/50'} ${unlocked ? '' : 'opacity-50'}`}
            >
              <button
                type="button"
                disabled={!unlocked}
                onClick={() => !open && startTask(task.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left disabled:cursor-not-allowed"
                aria-expanded={open}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    done ? 'bg-emerald-500/20 text-emerald-300' : open ? 'bg-sky-500/20 text-sky-200' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {done ? <IconCheck width={13} height={13} /> : unlocked ? i + 1 : <IconLock width={11} height={11} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13px] font-medium ${done ? 'text-slate-400' : 'text-slate-100'}`}>{task.title}</span>
                </span>
                {skipped && !done && <span className="shrink-0 text-[10px] text-slate-500">přeskočeno</span>}
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${LEVEL_TONE[task.level]}`}>{LEVELS[task.level]}</span>
              </button>
              {open && unlocked && <TaskDetail task={task} index={i} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------- Panel ---------------- */

export default function LearnPanel() {
  const mode = useStore(learnStore, (s) => s.mode);
  const done = useStore(learnStore, (s) => s.done.length);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <IconCap className="text-sky-400" />
        <span className="text-[13px] font-semibold text-slate-100">Výuka Dockeru</span>
        <div className="ml-auto flex rounded-md border border-slate-700 p-0.5 text-[12px]">
          {(
            [
              ['tutorial', 'Příručka'],
              ['tasks', `Úkoly ${done}/${TASKS.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => learnStore.set({ mode: id })}
              aria-pressed={mode === id}
              className={`rounded px-2.5 py-0.5 ${mode === id ? 'bg-sky-500/20 text-sky-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">{mode === 'tutorial' ? <TutorialView /> : <TasksView />}</div>
    </div>
  );
}
