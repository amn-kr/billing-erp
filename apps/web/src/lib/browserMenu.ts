/**
 * The browser's own right-click menu (Back, Save as, Translate, View page source, Inspect …) never
 * shows in the app (owner's decision, 18 Oct 2026); only the app's own menus do, such as a list
 * row's actions menu, which opens first and is not affected. Inside a text box the browser's small
 * copy / paste menu stays, so pasting with the mouse still works. Set once when the app starts.
 */

/** Inputs that hold no text: no copy / paste menu there. */
const NO_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden']);

/** True inside a text box, a text area or an editable area (where copy / paste is useful). */
export function inTextField(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
  if (!el) return false;
  const f = el.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
  if (!f) return false;
  if (f instanceof HTMLInputElement) return !NO_TEXT.has(f.type);
  return true;
}

/** Stops the browser's menu everywhere in the page except in text fields. Returns the undo. */
export function blockBrowserMenu(doc: Document = document): () => void {
  const stop = (e: MouseEvent) => { if (!inTextField(e.target)) e.preventDefault(); };
  doc.addEventListener('contextmenu', stop);
  return () => doc.removeEventListener('contextmenu', stop);
}
