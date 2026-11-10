/**
 * Printing one document, never the screen behind it (the prototype's printing-inv /
 * printing-rl idea, made to work inside the React app).
 *
 * A window that can be printed registers a source: the element to print, the file
 * name (document title, used by "Save as PDF") and the paper. Printing copies that
 * element to the end of <body> (a `.prclone`); the print CSS hides everything else.
 * The Print buttons call printNow(); Ctrl+P works too (beforeprint).
 */
import { useEffect, useRef } from 'react';
import { desktop } from '../../lib/desktop';
import { useStyles } from '../../lib/useStyles';
import { useShell } from '../shell/store';
import css from './print.css?inline';

/** the print layouts' and print-only CSS (features/print/print.css) while a document window is on screen */
export const usePrintStyles = () => useStyles([css], 'print');

export interface PrintSource { el: () => HTMLElement | null; title: string; page?: string; cls?: string }
const sources: PrintSource[] = [];
let undo: (() => void) | null = null;
/** the document now in the print area (its paper goes to the Windows app's direct printing) */
let current: PrintSource | null = null;

/** Copy the open window's document into the print area. Returns false when nothing is open. */
export function preparePrint(): boolean {
  cleanup();
  const src = sources[sources.length - 1];
  const el = src?.el();
  if (!src || !el) return false;
  current = src;
  const copy = el.cloneNode(true) as HTMLElement;
  copy.classList.add('prclone');
  copy.removeAttribute('hidden');
  document.body.appendChild(copy);
  const cls = src.cls ?? 'printing-doc';
  document.body.classList.add(cls);
  const style = document.createElement('style');
  style.textContent = `@page{${src.page ? `size:${src.page};` : ''}margin:0}`;
  document.head.appendChild(style);
  const title = document.title;
  document.title = src.title;
  undo = () => { copy.remove(); style.remove(); document.body.classList.remove(cls); document.title = title; };
  return true;
}

export function cleanup() {
  undo?.();
  undo = null;
}

let pending = 0;
/** The Print button: print the open document only. If it is still loading, print it as soon as it opens (never the screen behind). */
export function printNow() {
  if (preparePrint()) { void send(); return; }
  pending = Date.now();
}

/**
 * The document is in the print area (preparePrint). In the Windows app with a printer chosen on this
 * PC, it goes straight to that printer; otherwise (browser, no printer chosen, printer gone or
 * failed) the usual print window opens. Ctrl+P always opens the print window.
 */
async function send() {
  const d = desktop();
  if (d) {
    const r = await d.print(current?.page).catch(() => null);
    if (r?.ok) {
      cleanup();
      useShell.getState().showToast(`Printed on ${r.printer}`, 'ok');
      return;
    }
    if (r && r.reason === 'missing') useShell.getState().showToast('The printer chosen for this PC isn’t connected. Choose one in the print window.');
    if (r && r.reason === 'failed') useShell.getState().showToast(`Couldn’t print: ${r.message ?? 'the printer did not respond'}.`, 'error');
    // the print window: the document may have been tidied away while waiting
    if (!undo && !preparePrint()) return;
  }
  window.print();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => { if (!undo) preparePrint(); });
  window.addEventListener('afterprint', cleanup);
}

/** Register the open window's document while `open`. */
export function usePrintSource(open: boolean, src: PrintSource) {
  usePrintStyles();
  const ref = useRef(src);
  ref.current = src;
  useEffect(() => {
    if (!open) return;
    const s: PrintSource = { el: () => ref.current.el(), get title() { return ref.current.title; }, get page() { return ref.current.page; }, get cls() { return ref.current.cls; } };
    sources.push(s);
    if (pending && Date.now() - pending < 10_000) { pending = 0; setTimeout(() => { if (preparePrint()) void send(); }, 50); }
    return () => { const i = sources.indexOf(s); if (i >= 0) sources.splice(i, 1); };
  }, [open]);
}

/** A file name the browser keeps for "Save as PDF", e.g. "Tax Invoice INV-0001". */
export const fileTitle = (name: string, no: string) => `${name} ${no}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
