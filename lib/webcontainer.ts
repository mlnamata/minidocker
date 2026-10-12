'use client';

import type { WebContainer } from '@webcontainer/api';

declare global {
  // Přežije Fast Refresh v dev režimu – WebContainer smí na stránce běžet jen jednou.
  // eslint-disable-next-line no-var
  var __minidockerWebContainer: Promise<WebContainer> | undefined;
}

/** Singleton: WebContainer se bootuje jen jednou na stránku. */
export function bootWebContainer(): Promise<WebContainer> {
  if (!globalThis.__minidockerWebContainer) {
    const p = import('@webcontainer/api').then(({ WebContainer }) =>
      WebContainer.boot({ workdirName: 'minidocker', coep: 'require-corp' }),
    );
    globalThis.__minidockerWebContainer = p;
    p.catch(() => {
      globalThis.__minidockerWebContainer = undefined;
    });
  }
  return globalThis.__minidockerWebContainer;
}

export interface SupportInfo {
  ok: boolean;
  /** Blokující problém (WebContainer nepůjde spustit). */
  error?: string;
  /** Neblokující upozornění (např. jiný než Chromium prohlížeč). */
  warning?: string;
}

export function checkSupport(): SupportInfo {
  if (typeof window === 'undefined') return { ok: false, error: 'Běží mimo prohlížeč.' };
  if (!window.isSecureContext) {
    return {
      ok: false,
      error: 'Stránka musí běžet přes HTTPS (nebo na localhost) – WebContainers jinak nefungují.',
    };
  }
  if (!window.crossOriginIsolated) {
    return {
      ok: false,
      error:
        'Chybí cross-origin isolation. Server musí posílat hlavičky ' +
        '„Cross-Origin-Embedder-Policy: require-corp“ a „Cross-Origin-Opener-Policy: same-origin“ ' +
        '(viz next.config.js / vercel.json). Pokud je stránka vložená v iframe, otevřete ji samostatně.',
    };
  }
  if (typeof SharedArrayBuffer === 'undefined' || typeof WebAssembly === 'undefined') {
    return { ok: false, error: 'Prohlížeč nepodporuje SharedArrayBuffer/WebAssembly, které WebContainers potřebují.' };
  }
  const ua = navigator.userAgent;
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
  const chromium = brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand)) ?? /Chrome\//.test(ua);
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
  if (mobile) {
    return { ok: true, warning: 'Na mobilních zařízeních mají WebContainers omezenou podporu – doporučujeme desktopový Chrome/Edge.' };
  }
  if (!chromium) {
    return {
      ok: true,
      warning: /Firefox\//.test(ua)
        ? 'Firefox je podporován experimentálně. Nejspolehlivější je Chrome, Edge nebo jiný Chromium prohlížeč.'
        : 'Tento prohlížeč má omezenou podporu WebContainers. Doporučujeme Chrome, Edge nebo jiný Chromium prohlížeč.',
    };
  }
  return { ok: true };
}
