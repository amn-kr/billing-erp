import { useLayoutEffect, useRef } from 'react';

/**
 * The prototype's Escape rule for windows (#ipv, #slm, …): Escape closes every open
 * window, except while the "discard changes?" question is showing.
 */
export function useEscape(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  // attached before the window is drawn, so an Escape pressed as soon as it shows is not missed
  useLayoutEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.getElementById('dcf')?.hidden !== false) close.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
}
