/**
 * Item card › Stock by batch (Features › batch_expiry; owner-approved mock, 1 Nov 2026): what is left in
 * each batch, in the order it is used, worth the same in total as the item's stock value. Edit corrects
 * a batch's no. or dates (the audit log keeps the old ones).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { batchDateText, batchMonth, expiryLabel, expiryState, formatInr2, formatQty, money, sumValues, type BatchRow } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { today } from '../../lib/time';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useShell } from '../shell/store';
import { ui } from '../../styles/uiSize';

export function ExpiryTag({ expiry, on }: { expiry: string | null; on: string }) {
  const label = expiryLabel(expiry, on);
  return label ? <span className={`st ${expiryState(expiry, on) === 'expired' ? 'r' : 'a'}`}>{label}</span> : null;
}

export function BatchCard({ rows, shortQty, unit, canEdit }: { rows: BatchRow[]; shortQty: string; unit: string; canEdit: boolean }) {
  const [editing, setEditing] = useState<BatchRow | null>(null);
  const on = today();
  const total = rows.reduce((a, r) => a.plus(r.qty), money(0));
  return (
    <div className="card" id="itBatches" style={{ marginTop: ui.sp(16) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: ui.sp(10), marginBottom: ui.sp(10) }}>
        <h3 style={{ margin: 0, fontSize: ui.fs(16) }}>Stock by batch</h3>
        <span className="mu" style={{ fontSize: ui.fs(12.5) }}>{formatQty(total)} {unit} · earliest expiry first</span>
      </div>
      {rows.length ? (
        <div className="tw" style={{ margin: 0 }}>
          <table className="ptt2" style={{ width: '100%', minWidth: 0 }}>
            <thead><tr><th>Batch</th><th>Mfg</th><th>Expiry</th><th></th><th className="n">In stock</th><th className="n">Rate</th><th className="n">Value</th>{canEdit ? <th></th> : null}</tr></thead>
            <tbody id="itBatchRows">
              {rows.map((r) => (
                <tr key={r.id ?? 'none'} data-batch={r.no}>
                  <td><b style={{ fontWeight: 600 }}>{r.no}</b></td><td className="mu">{batchMonth(r.mfg)}</td><td>{batchMonth(r.expiry)}</td><td><ExpiryTag expiry={r.expiry} on={on} /></td>
                  <td className="n">{formatQty(r.qty)}</td><td className="n">{formatInr2(r.rate)}</td><td className="n">{formatInr2(r.value)}</td>
                  {canEdit ? <td className="n">{r.id ? <button type="button" className="btn sm" data-batchedit={r.no} onClick={() => setEditing(r)}>Edit</button> : null}</td> : null}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}><b>Total</b></td><td className="n"><b>{formatQty(total)}</b></td><td></td><td className="n"><b>{formatInr2(sumValues(rows.map((r) => r.value)))}</b></td>{canEdit ? <td></td> : null}</tr></tfoot>
          </table>
        </div>
      ) : <p className="mu" style={{ margin: 0, fontSize: ui.fs(13) }}>No stock yet. Batches show here once you buy or add stock.</p>}
      {money(shortQty).gt(0) ? <p className="xperr" style={{ margin: ui.sp('10px 0 0') }}>Stock is short by {formatQty(shortQty)} {unit}: more was sold than was bought.</p> : null}
      <EditBatch batch={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function EditBatch({ batch, onClose }: { batch: BatchRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [no, setNo] = useState('');
  const [mfg, setMfg] = useState('');
  const [exp, setExp] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useOpenFocus(!!batch, ref);
  useEffect(() => {
    if (!batch) return;
    setNo(batch.no); setMfg(batchDateText(batch.mfg, 'mfg')); setExp(batchDateText(batch.expiry, 'expiry')); setErr('');
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [batch, onClose]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/batches/${batch!.id}`, { method: 'PATCH', body: { batchNo: no, mfg, expiry: exp } });
      await Promise.all(['item', 'items'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`Batch ${no} saved`, 'ok');
      onClose();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not save the batch.');
    }
  };
  return (
    <div className="ov c" id="bxEdit" ref={ref} hidden={!batch} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'bxEdit') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bxEditT">
        <h3 id="bxEditT" style={{ margin: ui.sp('0 0 14px'), fontSize: ui.fs(18) }}>Edit batch</h3>
        <form noValidate onSubmit={save}>
          <label className="fl" htmlFor="bxNo">Batch no.<input className="fi" id="bxNo" value={no} autoComplete="off" onChange={(e) => setNo(e.target.value)} /></label>
          <div className="two">
            <label className="fl" htmlFor="bxMfg">Mfg<input className="fi" id="bxMfg" value={mfg} placeholder="MM/YY" autoComplete="off" onChange={(e) => setMfg(e.target.value)} /></label>
            <label className="fl" htmlFor="bxExp">Expiry<input className="fi" id="bxExp" value={exp} placeholder="MM/YY" autoComplete="off" onChange={(e) => setExp(e.target.value)} /></label>
          </div>
          <div className="msg bad" id="bxErr" role="alert">{err}</div>
          <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end' }}><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn p" type="submit" id="bxSave">Save</button></div>
        </form>
      </div>
    </div>
  );
}
