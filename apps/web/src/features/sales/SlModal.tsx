/** The small window the prototype uses for confirmations, history and payment history (#slm, slModal). */
import { useRef, type ReactNode } from 'react';
import { useEscape } from '../../lib/useEscape';
import { useOpenFocus } from '../../lib/useOpenFocus';

export interface SlModalProps {
  title: string;
  sub?: ReactNode;
  body?: ReactNode;
  /** OK button text; no OK button when left out */
  ok?: string;
  danger?: boolean;
  /** text of the other button (default "Keep it" with an OK button, else "Close") */
  cancel?: string;
  /** wide window: 1 = 860px, or a CSS width */
  wide?: 1 | string;
  onOk?: () => void;
}

export function SlModal({ m, onClose }: { m: SlModalProps | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOpenFocus(!!m, ref);
  useEscape(!!m, onClose);
  // the prototype's slModal sets the width only for wide windows (and clears it otherwise)
  const width = m?.wide ? (m.wide === 1 ? 'min(860px,100%)' : m.wide) : undefined;
  return (
    <div className="ov c" id="slm" hidden={!m} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'slm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="slmT" style={width ? { width } : undefined}>
        <h3 id="slmT" style={{ margin: '0 0 4px', fontSize: 18 }}>{m?.title}</h3><p className="mu" id="slmSub" style={{ margin: '0 0 14px', fontSize: 13 }}>{m?.sub}</p><div id="slmBody">{m?.body}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}><button className="btn" type="button" id="slmCancel" onClick={onClose}>{m?.cancel ?? (m?.ok ? 'Keep it' : 'Close')}</button>
          <button className={`btn p${m?.danger ? ' dz' : ''}`} type="button" id="slmOk" hidden={!m?.ok} style={m?.ok ? undefined : { display: 'none' }} onClick={m?.onOk}>{m?.ok ?? ''}</button></div>
      </div>
    </div>
  );
}
