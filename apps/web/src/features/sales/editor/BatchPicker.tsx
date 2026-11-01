/**
 * Choose batch (Features › batch_expiry; owner-approved mock, 1 Nov 2026): the batches of one line of the
 * sale, picked automatically earliest expiry first, changed here by hand. An expired batch can be chosen,
 * with a red note; saving the bill then asks "Sell expired stock?".
 */
import { useEffect, useRef, useState } from 'react';
import { batchDay, batchMonth, expiryState, formatQty, money, type BatchAlloc, type BatchRow } from '@billing/shared';
import { useEscape } from '../../../lib/useEscape';
import { useOpenFocus } from '../../../lib/useOpenFocus';
import { ExpiryTag } from '../../items/BatchCard';
import { ui } from '../../../styles/uiSize';

export interface PickFor { name: string; qty: string | number; unit: string; rows: BatchRow[]; allocs: BatchAlloc[]; auto: BatchAlloc[]; date: string }

const key = (id: string | null) => id ?? 'none';
const fill = (list: BatchAlloc[]) => Object.fromEntries(list.map((a) => [key(a.batchId), formatQty(a.qty)]));

export function BatchPicker({ pick, onClose, onDone }: { pick: PickFor | null; onClose: () => void; onDone: (allocs: BatchAlloc[] | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [take, setTake] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState('');
  useOpenFocus(!!pick, ref);
  useEscape(!!pick, onClose);
  useEffect(() => { if (pick) { setTake(fill(pick.allocs)); setAuto(false); setErr(''); } }, [pick]);
  if (!pick) return <div className="ov c" id="bxPick" hidden ref={ref}><div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bxPickT"></div></div>;
  // No batch is always offered, and so is a batch already on the line
  const rows: BatchRow[] = [...pick.rows];
  if (!rows.some((r) => r.id === null)) rows.unshift({ id: null, no: 'No batch', mfg: null, expiry: null, qty: '0.000', rate: '0', value: '0' });
  const want = money(String(pick.qty || 0));
  const n = (t: string) => { const v = Number(t.replace(/[^\d.]/g, '')); return Number.isFinite(v) ? v : 0; };
  const picked = rows.reduce((a, r) => a.plus(n(take[key(r.id)] ?? '')), money(0));
  const expired = rows.filter((r) => r.expiry && expiryState(r.expiry, pick.date) === 'expired' && n(take[key(r.id)] ?? '') > 0);
  const done = () => {
    if (!picked.eq(want)) return setErr(`Pick ${formatQty(want)} ${pick.unit} in all. You have picked ${formatQty(picked)}.`);
    const over = rows.find((r) => r.id && money(n(take[key(r.id)] ?? '')).gt(r.qty));
    if (over) return setErr(`Only ${formatQty(over.qty)} ${pick.unit} in batch ${over.no}.`);
    onDone(auto ? null : rows.flatMap((r) => { const q = n(take[key(r.id)] ?? ''); return q > 0 ? [{ batchId: r.id, qty: money(q).toFixed(3) }] : []; }));
  };
  return (
    <div className="ov c" id="bxPick" ref={ref} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'bxPick') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bxPickT" style={{ width: 'min(640px,100%)' }}>
        <h3 id="bxPickT" style={{ margin: ui.sp('0 0 4px'), fontSize: ui.fs(18) }}>Choose batch</h3>
        <p className="mu" style={{ margin: ui.sp('0 0 14px'), fontSize: ui.fs(13) }}>{pick.name} · Quantity on this bill <b>{formatQty(want)} {pick.unit}</b>. Picked automatically, earliest expiry first. Change it if you need to.</p>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2" style={{ width: '100%', minWidth: 0 }}>
          <thead><tr><th>Batch</th><th>Mfg</th><th>Expiry</th><th className="n">In stock</th><th className="n" style={{ width: ui.w(92) }}>Take</th></tr></thead>
          <tbody id="bxPickRows">{rows.map((r) => (
            <tr key={key(r.id)} data-batch={r.no}>
              <td><b style={{ fontWeight: 600 }}>{r.no}</b></td><td className="mu">{batchMonth(r.mfg)}</td><td>{batchMonth(r.expiry)} <ExpiryTag expiry={r.expiry} on={pick.date} /></td><td className="n">{formatQty(r.qty)}</td>
              <td className="n"><input className="fi" inputMode="decimal" autoComplete="off" aria-label={`Take from ${r.no}`} style={{ height: ui.h(34), textAlign: 'right', padding: ui.sp('0 8px'), margin: 0 }} value={take[key(r.id)] ?? ''}
                onChange={(e) => { setAuto(false); setErr(''); setTake({ ...take, [key(r.id)]: e.target.value.replace(/[^\d.]/g, '') }); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } }} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="hint" id="bxSum" style={{ margin: ui.sp('12px 0 0') }}>Picked <b>{formatQty(picked)} of {formatQty(want)} {pick.unit}</b>
          {expired.map((r) => <div className="xperr" key={key(r.id)} style={{ marginTop: ui.sp(6) }}>{r.no} expired on {batchDay(r.expiry!)}. You will be asked to confirm when you save.</div>)}</div>
        <div className="msg bad" id="bxPickErr" role="alert" style={{ marginTop: ui.sp(8) }}>{err}</div>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', marginTop: ui.sp(8), flexWrap: 'wrap' }}>
          <button type="button" className="btn" id="bxAuto" style={{ marginRight: 'auto' }} onClick={() => { setTake(fill(pick.auto)); setAuto(true); setErr(''); }}>Earliest expiry first</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn p" id="bxDone" onClick={done}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** Save asks this when the bill uses expired stock (the "Turn off GST?" window's look). Noted in the audit log. */
export function ExpiredAsk({ list, onNo, onYes }: { list: { item: string; no: string; expiry: string; qty: string }[] | null; onNo: () => void; onYes: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOpenFocus(!!list, ref);
  useEscape(!!list, onNo);
  return (
    <div className="ov c" id="bxExpired" ref={ref} hidden={!list}>
      <div className="mdl" role="alertdialog" aria-modal="true" aria-labelledby="bxExpiredT">
        <div className="ti" style={{ background: 'color-mix(in srgb,var(--red) 14%,transparent)', color: 'var(--red)', marginBottom: ui.sp(12) }}><svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.5" /></svg></div>
        <h3 id="bxExpiredT" style={{ margin: ui.sp('0 0 6px'), fontSize: ui.fs(18) }}>Sell expired stock?</h3>
        <p style={{ margin: ui.sp('0 0 18px'), color: 'var(--t2)' }}>{(list ?? []).map((e) => <span key={e.item + e.no} style={{ display: 'block' }}>{e.item}: {formatQty(e.qty)} of batch <b>{e.no}</b> expired on {batchDay(e.expiry)}.</span>)}This will be noted in the audit log.</p>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', flexWrap: 'wrap' }}><button className="btn" type="button" id="bxExpNo" onClick={onNo}>Go back and change</button><button className="btn dg" type="button" id="bxExpYes" onClick={onYes}>Sell anyway</button></div>
      </div>
    </div>
  );
}
