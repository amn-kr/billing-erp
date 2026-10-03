/**
 * "Discard this …?" (#dcf) — the prototype's askDiscard: closing a pop-up you have
 * typed into (×, Cancel, click outside, Esc) asks first. Enter twice or "Discard"
 * closes it; Esc or "Keep editing" goes back.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { create } from 'zustand';
import { Icon } from './Icon';

interface DcfState { what: string | null; fn: (() => void) | null; ask: (what: string, fn: () => void) => void; done: () => void }
export const useDcf = create<DcfState>((set) => ({
  what: null, fn: null,
  ask: (what, fn) => set({ what, fn }),
  done: () => set({ what: null, fn: null }),
}));

/**
 * Track whether something was typed or changed in a pop-up since it opened, and give
 * a close function that asks first when it was.
 */
export function useDiscardGuard(open: boolean, ref: RefObject<HTMLElement | null>, what: string, close: () => void) {
  // a ref, not state: redrawing in the middle of a keystroke would lose that keystroke in a controlled field
  const dirty = useRef(false);
  useLayoutEffect(() => {
    dirty.current = false;
    const el = ref.current;
    if (!open || !el) return;
    const mark = (e: Event) => { if (!(e.target as Element).closest?.('#dcf')) dirty.current = true; };
    el.addEventListener('input', mark, true);
    el.addEventListener('change', mark, true);
    return () => { el.removeEventListener('input', mark, true); el.removeEventListener('change', mark, true); };
  }, [open, ref]);
  return () => (dirty.current ? useDcf.getState().ask(what, () => { dirty.current = false; close(); }) : close());
}

export function DiscardDialog() {
  const { what, fn, done } = useDcf();
  const [armed, setArmedState] = useState(false);
  // read by the next Enter straight away, before the window redraws
  const armedRef = useRef(false);
  const setArmed = (v: boolean) => { armedRef.current = v; setArmedState(v); };
  const noRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const t = useRef(0);
  const before = useRef<Element | null>(null);
  const open = !!what;
  const finish = (yes: boolean) => {
    clearTimeout(t.current);
    setArmed(false);
    done();
    (before.current as HTMLElement | null)?.focus?.();
    if (yes) fn?.();
  };
  const arm = () => {
    if (armedRef.current) return finish(true);
    setArmed(true);
    yesRef.current?.focus();
    clearTimeout(t.current);
    t.current = window.setTimeout(() => setArmed(false), 2500);
  };
  const armRef = useRef(arm);
  armRef.current = arm;
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (!open) return;
    before.current = document.activeElement;
    setArmed(false);
    setTimeout(() => noRef.current?.focus(), 20);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); armRef.current(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finishRef.current(false); }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === noRef.current ? yesRef.current : noRef.current)?.focus(); }
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [open]);
  return (
    <div className="ov c" id="dcf" hidden={!open} onClick={(e) => { if ((e.target as HTMLElement).id === 'dcf') finish(false); }}>
      <div className="mdl dcfm" role="alertdialog" aria-modal="true" aria-labelledby="dcfT" aria-describedby="dcfD">
        <div className="dcfi"><Icon name="alert" /></div><h3 id="dcfT">Discard this {what ?? 'bill'}?</h3><p id="dcfD" className="mu">Your changes aren’t saved and will be lost.</p>
        <p className="dcfk"><kbd>Enter</kbd> <kbd>Enter</kbd> to discard · <kbd>Esc</kbd> to keep editing</p>
        <div className="dcfb"><button className="btn" type="button" id="dcfNo" ref={noRef} onClick={() => finish(false)}>Keep editing</button><button className={`btn p dz${armed ? ' armed' : ''}`} type="button" id="dcfYes" ref={yesRef} onClick={(e) => { if (e.detail === 0) return; finish(true); }}>{armed ? 'Press Enter again to discard' : 'Discard'}</button></div>
      </div>
    </div>
  );
}
