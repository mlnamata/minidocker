'use client';

import { Fragment, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  ALL_TASKS,
  answerQuiz,
  firstOpenLesson,
  isTaskOpen,
  LESSONS,
  resetTutorial,
  setLesson,
  skipTask,
  tutorialStore,
  type Block,
  type DoTask,
  type Lesson,
  type QuizTask,
  type Task,
} from '@/lib/tutorial';
import { terminalBridge, uiStore } from '@/lib/ui';
import { IconBack, IconBook, IconCheck, IconChevron, IconLock, IconPlay } from './icons';

/** Vykreslí text se značkami `kód` a **tučné**. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return (
            <code key={i} className="rounded bg-slate-800 px-1 py-px font-mono text-[0.92em] text-sky-200">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
          return (
            <b key={i} className="font-semibold text-slate-100">
              {part.slice(2, -2)}
            </b>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function TheoryBlock({ block }: { block: Block }) {
  if ('p' in block) {
    return (
      <p className="text-[13px] leading-relaxed text-slate-300">
        <Rich text={block.p} />
      </p>
    );
  }
  if ('code' in block) {
    return (
      <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[12px] leading-relaxed text-sky-100">
        {block.code}
      </pre>
    );
  }
  if ('list' in block) {
    return (
      <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-300 marker:text-slate-600">
        {block.list.map((item, i) => (
          <li key={i}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if ('tip' in block) {
    return (
      <p className="rounded-md border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[12.5px] leading-relaxed text-sky-100">
        <Rich text={block.tip} />
      </p>
    );
  }
  return (
    <dl className="divide-y divide-slate-800 overflow-hidden rounded-md border border-slate-800 text-[12.5px]">
      {block.table.map(([term, desc]) => (
        <div key={term} className="grid grid-cols-[minmax(0,40%)_1fr] gap-3 px-3 py-1.5">
          <dt className="break-words font-mono text-[12px] text-sky-200">{term}</dt>
          <dd className="leading-relaxed text-slate-300">
            <Rich text={desc} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Status = 'done' | 'skipped' | 'current' | 'open' | 'locked';

function StatusIcon({ status, index }: { status: Status; index: number }) {
  const base = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold';
  if (status === 'done') {
    return (
      <span className={`${base} bg-emerald-500/20 text-emerald-300`}>
        <IconCheck width={12} height={12} strokeWidth={3} />
        <span className="sr-only">Splněno</span>
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className={`${base} bg-slate-700/60 text-slate-400`} title="Přeskočeno">
        –<span className="sr-only">Přeskočeno</span>
      </span>
    );
  }
  if (status === 'locked') {
    return (
      <span className={`${base} text-slate-600`} title="Nejdřív splňte předchozí úkoly">
        <IconLock width={12} height={12} />
        <span className="sr-only">Zamčeno</span>
      </span>
    );
  }
  return (
    <span className={`${base} ${status === 'current' ? 'bg-sky-500 text-slate-950' : 'border border-slate-600 text-slate-400'}`}>{index + 1}</span>
  );
}

function DoTaskBody({ task }: { task: DoTask }) {
  const [showHint, setShowHint] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const wc = useStore(uiStore, (s) => s.wc);
  return (
    <div className="mt-2 space-y-2 pl-7">
      {task.action && (
        <button
          type="button"
          onClick={task.action.run}
          className="rounded-md border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/25"
        >
          {task.action.label}
        </button>
      )}
      {showHint && task.hint && (
        <p className="rounded-md bg-slate-800/60 px-2.5 py-1.5 text-xs leading-relaxed text-slate-300">
          <Rich text={task.hint} />
        </p>
      )}
      {showSolution && task.solution && (
        <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 py-1 pl-2.5 pr-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-sky-100" title={task.solution}>
            {task.solution}
          </code>
          <button
            type="button"
            disabled={wc !== 'ready'}
            onClick={() => {
              uiStore.set({ mobileTab: 'terminal' });
              void terminalBridge.run(task.solution!);
            }}
            title="Spustit v terminálu"
            className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-40"
          >
            <IconPlay width={11} height={11} /> Spustit
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {task.hint && (
          <button type="button" onClick={() => setShowHint((v) => !v)} className="text-slate-400 hover:text-slate-200">
            {showHint ? 'Skrýt nápovědu' : 'Nápověda'}
          </button>
        )}
        {task.solution && (
          <button type="button" onClick={() => setShowSolution((v) => !v)} className="text-slate-400 hover:text-slate-200">
            {showSolution ? 'Skrýt řešení' : 'Ukázat řešení'}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Přeskočit tento úkol? Bude označen jako přeskočený, ne splněný.')) skipTask(task.id);
          }}
          className="text-slate-500 hover:text-slate-300"
        >
          Přeskočit
        </button>
      </div>
    </div>
  );
}

function QuizBody({ task, done }: { task: QuizTask; done: boolean }) {
  const [picked, setPicked] = useState<number | null>(done ? task.answer : null);
  const correct = picked === task.answer;
  return (
    <div className="mt-2 space-y-1.5 pl-7">
      {task.options.map((opt, i) => {
        const chosen = picked === i;
        const tone = chosen
          ? correct
            ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
            : 'border-red-500/60 bg-red-500/10 text-red-100'
          : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-800/60';
        return (
          <button
            key={i}
            type="button"
            disabled={done}
            onClick={() => {
              setPicked(i);
              answerQuiz(task, i);
            }}
            className={`block w-full rounded-md border px-2.5 py-1.5 text-left text-xs leading-relaxed transition-colors disabled:cursor-default ${tone}`}
          >
            <Rich text={opt} />
          </button>
        );
      })}
      {picked !== null && (
        <p className={`text-xs leading-relaxed ${correct ? 'text-emerald-300' : 'text-red-300'}`}>
          {correct ? (
            <>
              <b>Správně.</b> <Rich text={task.explain} />
            </>
          ) : (
            'To není ono – zkuste to znovu.'
          )}
        </p>
      )}
    </div>
  );
}

function TaskItem({ task, index, status }: { task: Task; index: number; status: Status }) {
  const active = status === 'current' || status === 'open';
  return (
    <li
      className={`rounded-lg border p-2.5 ${
        status === 'current' ? 'border-sky-500/40 bg-sky-500/[0.06]' : 'border-slate-800 bg-slate-900/40'
      }`}
    >
      <div className="flex gap-2">
        <StatusIcon status={status} index={index} />
        <div className={`min-w-0 flex-1 text-[13px] leading-snug ${status === 'locked' ? 'text-slate-500' : status === 'done' || status === 'skipped' ? 'text-slate-400' : 'text-slate-200'}`}>
          {task.kind === 'quiz' && <span className="mr-1.5 rounded bg-violet-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-300">Kvíz</span>}
          <Rich text={task.title} />
        </div>
      </div>
      {task.kind === 'quiz' && status !== 'locked' && <QuizBody task={task} done={status === 'done'} />}
      {task.kind === 'do' && active && <DoTaskBody task={task} />}
    </li>
  );
}

function LessonView({ lesson, index }: { lesson: Lesson; index: number }) {
  const done = useStore(tutorialStore, (s) => s.done);
  // Výklad je rozbalený, dokud v lekci nesplníte první úkol (komponenta má key = lekce)
  const [theoryOpen, setTheoryOpen] = useState(() => !lesson.tasks.some((t) => done[t.id]));

  const complete = lesson.tasks.every((t) => done[t.id]);
  const currentId = ALL_TASKS.find((t) => t.kind === 'do' && !done[t.id])?.id;

  const statusOf = (task: Task): Status => {
    const p = done[task.id];
    if (p) return p.skipped ? 'skipped' : 'done';
    if (!isTaskOpen(task.id, done)) return 'locked';
    return task.id === currentId ? 'current' : 'open';
  };

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
          Lekce {index + 1} z {LESSONS.length}
        </div>
        <h2 className="mt-0.5 text-lg font-semibold leading-tight text-slate-100">{lesson.title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{lesson.goal}</p>
      </div>

      {!isTaskOpen(lesson.tasks[0].id, done) && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-100">
          <span className="flex-1">Úkoly se odemknou, až dokončíte předchozí lekce. Výklad si ale můžete přečíst už teď.</span>
          <button
            type="button"
            onClick={() => setLesson(firstOpenLesson(done))}
            className="shrink-0 rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-semibold hover:bg-amber-500/30"
          >
            Přejít na lekci {firstOpenLesson(done) + 1}
          </button>
        </div>
      )}

      <section>
        <button
          type="button"
          onClick={() => setTheoryOpen((o) => !o)}
          aria-expanded={theoryOpen}
          className="flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
        >
          <IconChevron width={12} height={12} className={`transition-transform ${theoryOpen ? 'rotate-90' : ''}`} />
          Výklad
        </button>
        {theoryOpen && (
          <div className="mt-2 space-y-3">
            {lesson.theory.map((b, i) => (
              <TheoryBlock key={i} block={b} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Úkoly</h3>
        <ol className="space-y-2">
          {lesson.tasks.map((t, i) => (
            <TaskItem key={t.id} task={t} index={i} status={statusOf(t)} />
          ))}
        </ol>
      </section>

      {complete && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-100">
          {index < LESSONS.length - 1 ? (
            <div className="flex items-center gap-3">
              <span className="flex-1">Lekce splněna! 🎉</span>
              <button
                type="button"
                onClick={() => setLesson(index + 1)}
                className="rounded-md bg-emerald-500/25 px-3 py-1 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/35"
              >
                Další lekce →
              </button>
            </div>
          ) : (
            <span>Gratulujeme, prošli jste celý tutoriál a znáte základy Dockeru! 🐳</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function TutorialPanel() {
  const loaded = useStore(tutorialStore, (s) => s.loaded);
  const lessonIndex = useStore(tutorialStore, (s) => s.lesson);
  const done = useStore(tutorialStore, (s) => s.done);
  const [menu, setMenu] = useState(false);

  if (!loaded) return <div className="p-6 text-center text-sm text-slate-500">Načítám tutoriál…</div>;

  const lesson = LESSONS[lessonIndex];
  const finished = ALL_TASKS.filter((t) => done[t.id]).length;
  const pct = Math.round((finished / ALL_TASKS.length) * 100);
  const next = firstOpenLesson(done);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLesson(lessonIndex - 1)}
            disabled={lessonIndex === 0}
            title="Předchozí lekce"
            aria-label="Předchozí lekce"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
          >
            <IconBack width={14} height={14} />
          </button>
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] font-medium text-slate-200 hover:bg-slate-800"
          >
            <IconBook width={14} height={14} className="shrink-0 text-sky-400" />
            <span className="truncate">
              {lessonIndex + 1}. {lesson.title}
            </span>
            <IconChevron width={12} height={12} className={`ml-auto shrink-0 text-slate-500 transition-transform ${menu ? '-rotate-90' : 'rotate-90'}`} />
          </button>
          <button
            type="button"
            onClick={() => setLesson(lessonIndex + 1)}
            disabled={lessonIndex === LESSONS.length - 1}
            title="Další lekce"
            aria-label="Další lekce"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
          >
            <IconBack width={14} height={14} className="rotate-180" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Postup tutoriálem"
          >
            <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 tabular-nums">
            {finished}/{ALL_TASKS.length} úkolů
          </span>
        </div>
      </div>

      {menu ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <ol className="space-y-1">
            {LESSONS.map((l, i) => {
              const n = l.tasks.filter((t) => done[t.id]).length;
              const complete = n === l.tasks.length;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setLesson(i);
                      setMenu(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] ${
                      i === lessonIndex ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                        complete ? 'bg-emerald-500/20 text-emerald-300' : i === next ? 'bg-sky-500 text-slate-950' : 'border border-slate-600 text-slate-400'
                      }`}
                    >
                      {complete ? <IconCheck width={12} height={12} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{l.title}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                      {n}/{l.tasks.length}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Začít tutoriál znovu? Postup ve všech lekcích se vymaže (projekt, images a kontejnery zůstanou).')) {
                resetTutorial();
                setMenu(false);
              }
            }}
            className="mt-3 w-full rounded-md px-2.5 py-1.5 text-left text-xs text-slate-500 hover:bg-red-500/10 hover:text-red-300"
          >
            Začít tutoriál znovu
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <LessonView key={lesson.id} lesson={lesson} index={lessonIndex} />
        </div>
      )}
    </div>
  );
}
