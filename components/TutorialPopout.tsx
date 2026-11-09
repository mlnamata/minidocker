'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { uiStore } from '@/lib/ui';
import TutorialPanel from './TutorialPanel';

/**
 * Tutoriál v samostatném okně. Okno je prázdné (about:blank) a React do něj
 * vykresluje přes portál – sdílí tak stav s hlavní stránkou (WebContainer,
 * terminál, kontroly úkolů běží dál v hlavním okně).
 */
let popup: Window | null = null;

const WINDOW_NAME = 'minidocker-tutorial';

/** Zkopíruje styly hlavní stránky do okna tutoriálu. */
function copyStyles(target: Document): MutationObserver {
  const copy = (node: Node) => {
    if (node instanceof HTMLStyleElement || (node instanceof HTMLLinkElement && node.rel === 'stylesheet')) {
      const clone = node.cloneNode(true) as HTMLElement;
      if (node instanceof HTMLLinkElement) (clone as HTMLLinkElement).href = node.href; // absolutní URL
      target.head.appendChild(clone);
    }
  };
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(copy);
  // V dev režimu se styly přidávají za běhu
  const mo = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(copy)));
  mo.observe(document.head, { childList: true });
  return mo;
}

/** Otevře tutoriál v novém okně. Volat přímo z kliknutí (jinak okno zablokuje prohlížeč). */
export function openTutorialWindow(): void {
  if (popup && !popup.closed) {
    popup.focus();
    return;
  }
  const w = window.open('', WINDOW_NAME, 'popup,width=520,height=860');
  if (!w) {
    window.alert('Prohlížeč zablokoval otevření nového okna. Povolte pro tuto stránku vyskakovací okna a zkuste to znovu.');
    return;
  }
  popup = w;
  const s = uiStore.get();
  uiStore.set({ tutorialPopout: true, rightTab: s.rightTab === 'learn' ? 'images' : s.rightTab });
}

export function closeTutorialWindow(): void {
  const w = popup;
  popup = null;
  uiStore.set({ tutorialPopout: false, rightTab: 'learn' });
  if (w && !w.closed) w.close();
}

export function focusTutorialWindow(): void {
  if (popup && !popup.closed) popup.focus();
  else closeTutorialWindow();
}

/** Vykreslí tutoriál do otevřeného okna (komponenta je trvale namountovaná v hlavní stránce). */
export default function TutorialPopout() {
  const open = useStore(uiStore, (s) => s.tutorialPopout);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const w = popup;
    if (!open || !w || w.closed) {
      if (open) uiStore.set({ tutorialPopout: false });
      return;
    }
    const doc = w.document;
    // Okno se jménem mohlo zůstat otevřené z dřívějška – začneme načisto
    doc.head.innerHTML = '';
    doc.body.innerHTML = '';
    doc.documentElement.lang = 'cs';
    doc.title = 'Tutoriál – MiniDocker';
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    doc.head.appendChild(meta);
    const icon = doc.createElement('link');
    icon.rel = 'icon';
    icon.href = new URL('/favicon.svg', window.location.href).href;
    doc.head.appendChild(icon);
    const mo = copyStyles(doc);
    const root = doc.createElement('div');
    root.style.height = '100vh';
    root.className = 'flex flex-col bg-panel';
    doc.body.appendChild(root);
    setContainer(root);

    // Zavření okna (křížkem nebo reloadem) → tutoriál se vrátí do panelu
    const onClose = () => {
      if (popup === w) closeTutorialWindow();
    };
    w.addEventListener('pagehide', onClose);
    // Zavření hlavní stránky zavře i okno tutoriálu
    const onMainUnload = () => w.close();
    window.addEventListener('pagehide', onMainUnload);

    return () => {
      mo.disconnect();
      w.removeEventListener('pagehide', onClose);
      window.removeEventListener('pagehide', onMainUnload);
      setContainer(null);
    };
  }, [open]);

  if (!open || !container) return null;
  return createPortal(<TutorialPanel popout />, container);
}
