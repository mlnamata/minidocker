'use client';

import { Store } from './store';

export type RightTab = 'images' | 'containers' | 'browser';
export type MobileTab = 'files' | 'editor' | 'docker' | 'terminal';
export type WcStatus = 'idle' | 'booting' | 'ready' | 'error' | 'unsupported';

export interface UiState {
  rightTab: RightTab;
  mobileTab: MobileTab;
  wc: WcStatus;
  wcError: string | null;
  browserUrl: string;
  browserHistory: string[];
  browserIndex: number;
  browserNonce: number;
  /** Vybraná složka v průzkumníku (kam se vytvoří nový soubor). */
  selectedDir: string;
}

export const uiStore = new Store<UiState>({
  rightTab: 'images',
  mobileTab: 'editor',
  wc: 'idle',
  wcError: null,
  browserUrl: '',
  browserHistory: [],
  browserIndex: -1,
  browserNonce: 0,
  selectedDir: '',
});

export function openInBrowser(url: string, switchTab = true): void {
  const s = uiStore.get();
  const history = [...s.browserHistory.slice(0, s.browserIndex + 1), url];
  uiStore.set({
    browserUrl: url,
    browserHistory: history,
    browserIndex: history.length - 1,
    browserNonce: s.browserNonce + 1,
    ...(switchTab ? { rightTab: 'browser' as const, mobileTab: 'docker' as const } : {}),
  });
}

export function browserBack(): void {
  const s = uiStore.get();
  if (s.browserIndex <= 0) return;
  const i = s.browserIndex - 1;
  uiStore.set({ browserIndex: i, browserUrl: s.browserHistory[i], browserNonce: s.browserNonce + 1 });
}

export function browserReload(): void {
  uiStore.set((s) => ({ browserNonce: s.browserNonce + 1 }));
}

/**
 * Most mezi UI a terminálem: tlačítka v horní liště a panelech spouští
 * příkazy v terminálu, aby uživatel viděl odpovídající docker CLI.
 */
export const terminalBridge: {
  /** Spustí příkaz v terminálu (jako by ho uživatel napsal) a vrátí exit code. */
  run: (command: string) => Promise<number>;
  print: (text: string) => void;
} = {
  run: async () => 1,
  print: () => undefined,
};
