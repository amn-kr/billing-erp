import { useEffect, useState } from 'react';
import { useShell } from './store';

/** <div class="toast" id="toast" role="status">, shown for 2.2 s like the prototype. */
export function Toast() {
  const toast = useShell((s) => s.toast);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 2200);
    return () => clearTimeout(t);
  }, [toast]);
  return <div className={on ? 'toast on' : 'toast'} id="toast" role="status">{toast?.text ?? ''}</div>;
}
