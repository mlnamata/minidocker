'use client';

import type { WebContainer } from '@webcontainer/api';
import { dirname, normalize, projectPath } from './paths';
import { debounced, KEYS, load } from './storage';
import { Store } from './store';
import { getTemplate } from './templates';
import type { ProjectState } from './types';

export const PROJECT_DIR = 'project';

export const projectStore = new Store<ProjectState>({
  name: 'express-app',
  template: 'node-express',
  files: {},
  dirs: [],
  active: null,
  loaded: false,
});

/** Všechny složky projektu (explicitní i odvozené z cest souborů). */
export function allDirs(state: Pick<ProjectState, 'files' | 'dirs'>): Set<string> {
  const set = new Set<string>();
  const add = (p: string) => {
    let d = p;
    while (d && d !== '.') {
      set.add(d);
      d = dirname(d);
    }
  };
  for (const d of state.dirs) add(d);
  for (const f of Object.keys(state.files)) add(dirname(f));
  set.delete('');
  return set;
}

export function exists(path: string): boolean {
  const s = projectStore.get();
  return path in s.files || allDirs(s).has(path);
}

export function loadTemplate(id: string): void {
  const t = getTemplate(id);
  projectStore.set({
    name: t.name,
    template: t.id,
    files: { ...t.files },
    dirs: [],
    active: t.open,
    loaded: true,
  });
}

const persist = debounced(KEYS.project, 400);

export async function initProject(): Promise<void> {
  const saved = await load<ProjectState>(KEYS.project);
  if (saved && saved.files && Object.keys(saved.files).length) {
    projectStore.set({ ...saved, loaded: true });
  } else {
    loadTemplate('node-express');
  }
  projectStore.subscribe(() => {
    const { name, template, files, dirs, active } = projectStore.get();
    persist({ name, template, files, dirs, active });
  });
}

export function setActive(path: string | null): void {
  projectStore.set({ active: path });
}

export function updateFile(path: string, content: string): void {
  const s = projectStore.get();
  if (s.files[path] === content) return;
  projectStore.set({ files: { ...s.files, [path]: content } });
}

export function validateName(name: string): string | null {
  if (!name.trim()) return 'Název nesmí být prázdný.';
  if (name.includes('/') || name.includes('\\')) return 'Název nesmí obsahovat lomítko.';
  if (name === '.' || name === '..') return 'Neplatný název.';
  return null;
}

export function createFile(path: string, content = ''): string | null {
  const p = projectPath(path);
  if (exists(p)) return `„${p}“ už existuje.`;
  const s = projectStore.get();
  projectStore.set({ files: { ...s.files, [p]: content }, active: p });
  return null;
}

export function createDir(path: string): string | null {
  const p = projectPath(path);
  if (exists(p)) return `„${p}“ už existuje.`;
  const s = projectStore.get();
  projectStore.set({ dirs: [...s.dirs, p] });
  return null;
}

export function renamePath(from: string, to: string): string | null {
  const src = projectPath(from);
  const dst = projectPath(to);
  if (src === dst) return null;
  if (exists(dst)) return `„${dst}“ už existuje.`;
  const s = projectStore.get();
  const files: Record<string, string> = {};
  for (const [p, content] of Object.entries(s.files)) {
    if (p === src) files[dst] = content;
    else if (p.startsWith(src + '/')) files[dst + p.slice(src.length)] = content;
    else files[p] = content;
  }
  const dirs = s.dirs.map((d) => (d === src ? dst : d.startsWith(src + '/') ? dst + d.slice(src.length) : d));
  let active = s.active;
  if (active === src) active = dst;
  else if (active?.startsWith(src + '/')) active = dst + active.slice(src.length);
  projectStore.set({ files, dirs, active });
  return null;
}

export function deletePath(path: string): void {
  const p = projectPath(path);
  const s = projectStore.get();
  const files: Record<string, string> = {};
  for (const [f, content] of Object.entries(s.files)) {
    if (f !== p && !f.startsWith(p + '/')) files[f] = content;
  }
  const dirs = s.dirs.filter((d) => d !== p && !d.startsWith(p + '/'));
  const active = s.active && (s.active === p || s.active.startsWith(p + '/')) ? null : s.active;
  projectStore.set({ files, dirs, active });
}

/* ------------------------------------------------------------------ */
/* Synchronizace projektu → WebContainer (/project), aby šel použít    */
/* i ze shellu (ls, cat, node, npm …).                                 */
/* ------------------------------------------------------------------ */

export function startProjectSync(wc: WebContainer): () => void {
  let synced: Pick<ProjectState, 'files' | 'dirs'> = { files: {}, dirs: [] };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();

  const sync = async () => {
    const next = projectStore.get();
    const prevDirs = allDirs(synced);
    const nextDirs = allDirs(next);
    const at = (p: string) => normalize(`${PROJECT_DIR}/${p}`);
    try {
      for (const f of Object.keys(synced.files)) {
        if (!(f in next.files)) await wc.fs.rm(at(f), { force: true });
      }
      for (const d of [...prevDirs].sort((a, b) => b.length - a.length)) {
        if (!nextDirs.has(d)) await wc.fs.rm(at(d), { recursive: true, force: true });
      }
      for (const d of [...nextDirs].sort()) {
        if (!prevDirs.has(d)) await wc.fs.mkdir(at(d), { recursive: true });
      }
      for (const [f, content] of Object.entries(next.files)) {
        if (synced.files[f] !== content) await wc.fs.writeFile(at(f), content);
      }
      synced = { files: next.files, dirs: next.dirs };
    } catch (e) {
      console.warn('[sync] chyba synchronizace projektu', e);
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      running = running.then(sync);
    }, 250);
  };

  running = wc.fs.mkdir(PROJECT_DIR, { recursive: true }).then(() => sync());
  const unsub = projectStore.subscribe(schedule);
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
