/** Price history (#phm) — the prototype's dialog, filled from the server's price history. */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { RawIcon } from '../../components/Icon';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { histField } from './model';
import { ui } from '../../styles/uiSize';

interface Row { at: string; itemId: string; item: string; field: string; oldValue: string | null; newValue: string | null; how: string; by: string }
const X = '<path d="M6 6l12 12M18 6L6 18"/>';
const when = (d: string) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function HistoryDialog({ open, fname, onClose }: { open: boolean; fname: (f: string) => string; onClose: () => void }) {
  const ovRef = useRef<HTMLDivElement>(null);
  useOpenFocus(open, ovRef);
  const h = useQuery({ queryKey: ['price-history'], queryFn: () => api<Row[]>('/prices/history'), enabled: open });
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  const H = h.data ?? [];
  return (
    <div className="ov c" id="phm" ref={ovRef} hidden={!open} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'phm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="phT" style={{ width: 'min(820px,100%)' }}>
        <div className="dh"><h3 id="phT" style={{ margin: 0, fontSize: ui.fs(18) }}>Price history</h3><button className="ib" type="button" id="phClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <div className="tw stk" style={{ margin: ui.sp('12px 0 0'), maxHeight: '60vh', overflow: 'auto' }}><table className="ptt2" style={{ minWidth: 640 }}><thead><tr><th>When</th><th>Item</th><th>Price</th><th className="n">Old</th><th className="n">New</th><th>How</th></tr></thead>
          <tbody id="phRows">
            {h.data && (H.length ? H.slice(0, 200).map((r, k) => (
              <tr key={k}><td>{when(r.at)}</td><td>{r.item}</td><td>{fname(histField(r.field))}</td><td className="n">{r.oldValue === null ? '' : inr2f(r.oldValue)}</td><td className="n"><b>{r.newValue === null ? '' : inr2f(r.newValue)}</b></td><td className="mu">{r.how} · {r.by || 'Owner'}</td></tr>
            )) : <tr><td colSpan={6} className="ptempty">No price changes yet.</td></tr>)}
          </tbody></table></div>
      </div>
    </div>
  );
}
