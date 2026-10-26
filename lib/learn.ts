'use client';

import { dockerStore, normalizeRef } from './engine';
import { projectStore } from './project';
import { debounced, KEYS, load } from './storage';
import { Store } from './store';
import type { Container, Image } from './types';

/* ------------------------------------------------------------------ */
/* Výuka: postup v tutoriálu a úkolech                                  */
/* ------------------------------------------------------------------ */

export type LearnMode = 'tutorial' | 'tasks';

export interface LearnState {
  mode: LearnMode;
  tutorialStep: number;
  tutorialDone: boolean;
  /** ID aktuálního úkolu (null = všechny splněné / zatím nevybraný). */
  current: string | null;
  /** Od kdy se počítají příkazy pro aktuální úkol. */
  currentSince: number;
  done: string[];
  skipped: string[];
  /** Kolik nápověd je u úkolu odkrytých. */
  hints: Record<string, number>;
  /** Úkol splněný právě teď (pro oslavné hlášení v liště). */
  celebrate: string | null;
  /** UI prvek zvýrazněný tutoriálem (hodnota atributu data-tour). */
  highlight: string | null;
  loaded: boolean;
}

export const learnStore = new Store<LearnState>({
  mode: 'tutorial',
  tutorialStep: 0,
  tutorialDone: false,
  current: null,
  currentSince: 0,
  done: [],
  skipped: [],
  hints: {},
  celebrate: null,
  highlight: null,
  loaded: false,
});

const persist = debounced(KEYS.learn, 300);

/** Vrací true, pokud výuka ještě nebyla nikdy otevřena (první návštěva). */
export async function initLearn(): Promise<boolean> {
  const saved = await load<Partial<LearnState>>(KEYS.learn);
  learnStore.set({ ...(saved ?? {}), celebrate: null, highlight: null, currentSince: Date.now(), loaded: true });
  learnStore.subscribe(() => {
    const { mode, tutorialStep, tutorialDone, current, done, skipped, hints } = learnStore.get();
    persist({ mode, tutorialStep, tutorialDone, current, done, skipped, hints });
  });
  return !saved;
}

/* ---------------- log příkazů z terminálu ---------------- */

export interface CommandRecord {
  line: string;
  code: number;
  t: number;
}

export const commandStore = new Store<{ log: CommandRecord[] }>({ log: [] });

/** Volá shell po dokončení každého příkazu (napsaného i spuštěného tlačítkem). */
export function recordCommand(line: string, code: number): void {
  const log = [...commandStore.get().log, { line: line.replace(/\s+/g, ' '), code, t: Date.now() }].slice(-200);
  commandStore.set({ log });
}

/* ---------------- kontext pro kontrolu úkolů ---------------- */

export interface TaskContext {
  images: Image[];
  containers: Container[];
  files: Record<string, string>;
  /** Příkazy spuštěné od začátku aktuálního úkolu. */
  commands: CommandRecord[];
  image(ref: string): Image | undefined;
  container(name: string): Container | undefined;
  imageOf(ct: Container): Image | undefined;
  /** Úspěšně proběhl příkaz odpovídající regulárnímu výrazu? */
  ran(re: RegExp): boolean;
}

export function taskContext(since: number): TaskContext {
  const { images, containers } = dockerStore.get();
  const { files } = projectStore.get();
  const commands = commandStore.get().log.filter((r) => r.t >= since);
  return {
    images,
    containers,
    files,
    commands,
    image: (ref) => images.find((i) => i.repoTags.includes(normalizeRef(ref))),
    container: (name) => containers.find((ct) => ct.name === name),
    imageOf: (ct) => images.find((i) => i.id === ct.imageId),
    ran: (re) => commands.some((r) => r.code === 0 && re.test(r.line)),
  };
}

/* ---------------- akce ---------------- */

export function setHighlight(id: string | null): void {
  if (learnStore.get().highlight !== id) learnStore.set({ highlight: id });
}

export function startTask(id: string): void {
  learnStore.set({ current: id, currentSince: Date.now(), celebrate: null, mode: 'tasks' });
}

export function revealHint(id: string): void {
  const hints = learnStore.get().hints;
  learnStore.set({ hints: { ...hints, [id]: (hints[id] ?? 0) + 1 } });
}

export function completeTask(id: string): void {
  const s = learnStore.get();
  if (s.done.includes(id)) return;
  learnStore.set({ done: [...s.done, id], skipped: s.skipped.filter((x) => x !== id), celebrate: id });
}

export function skipTask(id: string): void {
  const s = learnStore.get();
  if (!s.skipped.includes(id)) learnStore.set({ skipped: [...s.skipped, id] });
}

export function resetLearn(): void {
  learnStore.set({
    mode: 'tutorial',
    tutorialStep: 0,
    tutorialDone: false,
    current: null,
    currentSince: Date.now(),
    done: [],
    skipped: [],
    hints: {},
    celebrate: null,
    highlight: null,
  });
}
