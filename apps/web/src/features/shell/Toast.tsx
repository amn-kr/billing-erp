import { useEffect, useState } from 'react';
import { useShell, type ToastMsg } from './store';

/** How long a message stays: a red one longer, so the reason can be read. */
const STAY = { info: 2200, ok: 2200, error: 4000 } as const;
const CLS = { info: '', ok: ' ok', error: ' bad' } as const;

/**
 * <div class="toast" id="toast" role="status">, shown for 2.2 s like the prototype (4 s when red).
 * Each message is shown once and taken out of the store, so drawing the app again never repeats it.
 */
export function Toast() {
  const toast = useShell((s) => s.toast);
  const [shown, setShown] = useState<ToastMsg | null>(null);
  const [on, setOn] = useState(false);
  // a message left over from before this was drawn is old: it is dropped, not shown
  const [old] = useState(() => useShell.getState().toast?.n);
  useEffect(() => {
    if (!toast) return;
    useShell.setState({ toast: null });
    if (toast.n === old) return;
    setShown(toast);
    setOn(true);
  }, [toast, old]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setOn(false), STAY[shown.kind]);
    return () => clearTimeout(t);
  }, [shown]);
  return <div className={`toast${on ? ' on' : ''}${shown ? CLS[shown.kind] : ''}`} id="toast" role="status">{shown?.text ?? ''}</div>;
}
