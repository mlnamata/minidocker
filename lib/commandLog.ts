'use client';

import { Store } from './store';

export interface CommandRecord {
  /** Příkaz tak, jak ho uživatel napsal (oříznutý). */
  cmd: string;
  /** Exit code příkazu (130 = přerušeno Ctrl+C). */
  code: number;
  /** Čas dokončení příkazu. */
  t: number;
}

/**
 * Záznam příkazů spuštěných v terminálu. Používá ho tutoriál k ověření,
 * že si uživatel příkaz opravdu vyzkoušel.
 */
export const commandLog = new Store<{ entries: CommandRecord[] }>({ entries: [] });

export function recordCommand(cmd: string, code: number): void {
  const entries = [...commandLog.get().entries, { cmd, code, t: Date.now() }];
  commandLog.set({ entries: entries.slice(-300) });
}
