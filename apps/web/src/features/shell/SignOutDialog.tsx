import { useEffect, useRef } from 'react';
import { ui } from '../../styles/uiSize';

/** The prototype's "Sign out?" dialog (#so). */
export function SignOutDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      prev?.focus?.();
    };
  }, [open, onCancel]);
  return (
    <div className="ov c" id="so" hidden={!open}>
      <div className="mdl" role="alertdialog" aria-modal="true" aria-labelledby="soT">
        <h3 id="soT" style={{ margin: ui.sp('0 0 6px'), fontSize: ui.fs(18) }}>Sign out?</h3>
        <p style={{ margin: ui.sp('0 0 18px'), color: 'var(--t2)' }}>You’ll need your mobile number or email and password to sign in again. Your data stays saved.</p>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn" id="soNo" ref={first} onClick={onCancel}>Stay signed in</button>
          <button className="btn dg" id="soYes" onClick={onConfirm}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
