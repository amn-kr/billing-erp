/** Preview price changes (#ppv): the prototype's previewChanges(); Apply sends them with the price PIN. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { RawIcon } from '../../components/Icon';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useShell } from '../shell/store';
import { API_FIELD, rawOverride, usePm, type Change, type PriceData } from './model';
import { nudgeLock } from './PricesPage';

export interface Preview { changes: Change[]; how: string; note: ReactNode; after?: () => void }
const X = '<path d="M6 6l12 12M18 6L6 18"/>';

/** Send changes (with the PIN) and remember how to undo them. */
export async function sendChanges(changes: Change[], how: string, qc: ReturnType<typeof useQueryClient>) {
  const pin = usePm.getState().pin;
  if (!pin) throw new ApiError(400, 'Prices are locked. Click the lock to unlock with your PIN');
  const snap = changes.map((c) => ({ id: c.i.id, f: c.f, old: rawOverride(c.i, c.f) }));
  await api('/prices/changes', { body: { how, pin, changes: changes.map((c) => ({ itemId: c.i.id, field: c.f.startsWith('pl:') ? c.f : API_FIELD[c.f], value: c.reset ? null : c.nv })) } });
  usePm.getState().set({ undo: [...usePm.getState().undo, { snap, how, n: changes.length }], hint: 'view' });
  await Promise.all(['items', 'prices', 'price-lists', 'price-history'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function PreviewDialog({ preview, data, mrpOn, onClose, onApplied }: { preview: Preview | null; data: PriceData; mrpOn: boolean; onClose: () => void; onApplied?: (changes: Change[]) => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [busy, setBusy] = useState(false);
  const ovRef = useRef<HTMLDivElement>(null);
  useOpenFocus(!!preview, ovRef);
  useEffect(() => {
    if (!preview) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [preview, onClose]);
  const changes = preview?.changes ?? [];
  const isSale = (c: Change) => c.f === 'sale' || c.f.startsWith('pl:');
  const warn = (c: Change): ReactNode[] => {
    const w: ReactNode[] = [];
    const nv = c.nv ?? 0;
    const mrp = c.f === 'mrp' ? nv : c.i.mrp;
    const pur = c.f === 'purch' ? nv : c.i.purch;
    if (mrpOn && mrp && isSale(c) && nv > mrp) w.push(<span className="neg" key="m">Above MRP</span>);
    if (pur && isSale(c) && nv < pur) w.push(<span className="neg" key="p">Below purchase price</span>);
    else if (pur && isSale(c) && (nv - pur) / pur < 0.05) w.push(<span className="lowq" key="l">Margin under 5%</span>);
    return w.flatMap((x, k) => (k ? [' ', x] : [x]));
  };
  const up = changes.filter((c) => (c.nv ?? 0) > c.ov).length;
  const dn = changes.filter((c) => (c.nv ?? 0) < c.ov).length;
  const bad = changes.filter((c) => warn(c).length).length;

  async function apply() {
    if (!preview || busy) return;
    if (!usePm.getState().pin) { onClose(); return nudgeLock(); }
    setBusy(true);
    try {
      await sendChanges(preview.changes, preview.how, qc);
      preview.after?.();
      onClose();
      showToast(`${preview.changes.length} price${preview.changes.length > 1 ? 's' : ''} updated · Undo is available`);
      onApplied?.(preview.changes);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not save the prices.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ov c" id="ppv" ref={ovRef} hidden={!preview} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'ppv') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="ppvT" style={{ width: 'min(820px,100%)' }}>
        <div className="dh"><div><small className="mu">Preview price changes</small><h3 id="ppvT" style={{ margin: '2px 0 0', fontSize: 18 }}>{preview?.how}</h3></div><button className="ib" type="button" id="ppvCancel" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <div className="ppvsum" id="ppvSum">{preview && <><span><b>{changes.length}</b> prices will change</span><span className="pos">▲ {up} up</span><span className="neg">▼ {dn} down</span>{bad ? <span className="lowq">{bad} need a look</span> : null}</>}</div><p className="hint" id="ppvNote" style={{ margin: '0 0 8px' }}>{preview?.note}</p>
        <div className="tw stk" style={{ margin: 0, maxHeight: '52vh', overflow: 'auto' }}><table className="ptt2" style={{ minWidth: 620 }}><thead><tr><th>Item</th><th>Price</th><th className="n">Now</th><th className="n">New</th><th className="n">Change</th><th></th></tr></thead>
          <tbody id="ppvRows">
            {changes.map((c, k) => {
              const nv = c.nv ?? 0;
              const d = c.ov ? ((nv - c.ov) / c.ov) * 100 : 0;
              return <tr key={k}><td><b style={{ fontWeight: 600 }}>{c.i.name}</b></td><td>{data.fname(c.f)}</td><td className="n">{inr2f(c.ov)}</td><td className="n"><b>{inr2f(nv)}</b></td><td className={`n ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}>{c.ov ? (d > 0 ? '+' : '') + d.toFixed(1) + '%' : 'new'}</td><td>{warn(c)}</td></tr>;
            })}
          </tbody></table></div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}><span className="mu" style={{ fontSize: 12, alignSelf: 'center', flex: 1 }}>You can undo this afterwards.</span><button className="btn p" id="ppvApply" onClick={apply}>{preview ? `Apply ${changes.length} change${changes.length > 1 ? 's' : ''}` : 'Apply'}</button></div>
      </div>
    </div>
  );
}
