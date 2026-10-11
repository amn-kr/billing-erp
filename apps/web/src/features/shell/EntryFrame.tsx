/**
 * The full-screen frame shared by the invoice-style entry windows (Sale, Quotation, Purchase bill /
 * order, Debit note): the sidebar and top bar make way while the editor is open, and a close (×)
 * button sits in the top-right corner of the title line.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useStyles } from '../../lib/useStyles';
import css from './entry-frame.css?inline';

/** Full-screen mode for as long as the calling editor is on screen. */
export function useFullscreen(): void {
  useStyles([css], 'entry-frame');
  useLayoutEffect(() => {
    const app = document.getElementById('app');
    app?.classList.add('efull');
    return () => app?.classList.remove('efull');
  }, []);
}

/** Anything open on top of the form (a window, pop-up or list) takes Esc first. */
const OPEN = '.ov,[role="dialog"],.pop,.dgpop,.cbl';
const somethingOpen = () => [...document.querySelectorAll<HTMLElement>(OPEN)].some((el) => !el.hidden && el.getClientRects().length > 0);

/** Two presses of × (or of Enter on it) this close together count as a double action. */
const TWICE_MS = 500;

/**
 * Close (×) in the top-right corner of the window. With something entered it takes a double action
 * (double-click, or Enter twice) and then leaves without the discard question; a single press only
 * shows a hint. An empty entry closes on a single press. Esc goes through the editor's back as before
 * (with the discard question). Leaving never touches a saved document: it only drops what is unsaved.
 */
export function EntryClose({ onBack, onLeave, dirty, label }: { onBack: () => void; onLeave: () => void; dirty: boolean; label: string }) {
  const fn = useRef({ onBack, onLeave });
  fn.current = { onBack, onLeave };
  const btn = useRef<HTMLButtonElement>(null);
  const last = useRef(0);
  const [hint, setHint] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    // window capture runs before the editors' own Esc handlers, so this sees the screen as it was
    // when Esc was pressed: an open pop-up or list closes first, and only a later Esc closes the window
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || somethingOpen()) return;
      e.preventDefault();
      fn.current.onBack();
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, []);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 2000);
    return () => clearTimeout(t);
  }, [hint]);
  const press = (e: React.MouseEvent<HTMLButtonElement>) => {
    const now = Date.now();
    // a mouse double-click reports detail 2; Enter on a focused button reports detail 0
    const twice = e.detail >= 2 || (e.detail === 0 && now - last.current < TWICE_MS);
    last.current = now;
    if (!dirty || twice) { last.current = 0; setHint(null); fn.current.onLeave(); return; }
    const r = btn.current!.getBoundingClientRect();
    setHint({ top: r.bottom + 6, right: innerWidth - r.right });
  };
  return (
    <>
      <button className="ib efx" type="button" id="efClose" ref={btn} aria-label={label} aria-describedby={hint ? 'efHint' : undefined} title={dirty ? 'Double-click to cancel entry' : label} onClick={press}><Icon name="x" /></button>
      {hint ? <div className="fly tip" id="efHint" role="status" style={{ top: hint.top, right: hint.right }}>Double-click to cancel entry</div> : null}
    </>
  );
}
