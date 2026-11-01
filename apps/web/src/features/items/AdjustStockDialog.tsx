/** Adjust stock (#adj) — same markup and checks as the prototype; saves a numbered stock adjustment. */
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { batchDateText, formatQty, money, stockAfterAdjustment, stockBeforeAdjustment } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { useCur } from '../../lib/settings';
import { today } from '../../lib/time';
import { useShell } from '../shell/store';
import { useDiscardGuard } from '../../components/Discard';
import { qfmt, type Item } from './ItemsPage';
import { editAsk, withPasscode } from '../settings/passcode';
import { useFeature } from '../../lib/features';
import { batchOption, useItemBatches } from '../purchases/BatchRow';
import type { Adjustment } from '../stock/AdjustmentsPage';
import { ui } from '../../styles/uiSize';

const REASONS = ['Physical count correction', 'Damaged', 'Expired', 'Lost or stolen', 'Free sample / gift', 'Own use', 'Other'];

/**
 * `choices` set: opened from Stock adjustments › New adjustment, with the item picker shown (first item chosen).
 * `edit` set: the saved adjustment fills the window; saving changes it (same number, passcode when it is on).
 */
export function AdjustStockDialog({ item, choices, edit, onClose }: { item: Item | null; choices?: Item[]; edit?: Adjustment | null; onClose: () => void }) {
  const cur = useCur();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [mode, setMode] = useState<'add' | 'reduce'>('add');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(today());
  const [why, setWhy] = useState(REASONS[0]!);
  const [err, setErr] = useState('');
  const qtyRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLSelectElement>(null);
  const [it, setIt] = useState<Item | null>(item);
  const ovRef = useRef<HTMLDivElement>(null);
  const close = useDiscardGuard(!!item, ovRef, 'stock adjustment', onClose);
  const closeRef = useRef(close);
  closeRef.current = close;
  const [picked, setPicked] = useState(false);
  // Features › batch_expiry: a tracked item's adjustment names its batch
  const batchOn = useFeature('batch_expiry');
  const track = batchOn && !!it?.trackBatch;
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [batchId, setBatchId] = useState('');
  const batches = useItemBatches(it?.id, track && mode === 'reduce').data?.rows ?? [];

  // reset before the window is painted, so nothing typed straight away is lost
  useLayoutEffect(() => {
    if (!item) return;
    setIt(item); setPicked(false);
    setMode('add'); setQty(''); setPrice(String(Number(item.purchase))); setDate(today()); setWhy(REASONS[0]!); setErr(''); setBatchNo(''); setExpiry(''); setBatchId('');
    if (edit) {
      setBatchNo(edit.batchNo ?? ''); setExpiry(batchDateText(edit.expiry, 'expiry')); setBatchId(edit.batchId ?? '');
      const q = Number(edit.qty);
      setMode(q < 0 ? 'reduce' : 'add'); setQty(String(Math.abs(q))); setPrice(String(Number(edit.rate))); setDate(edit.date); setWhy(edit.reason);
    }
    setTimeout(() => (choices ? pickRef.current : qtyRef.current)?.focus(), 0);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, edit, onClose]);

  // editing: the stock as if this adjustment had not been made
  const saved = edit ? { itemId: edit.itemId, qty: edit.qty } : null;
  const s = it ? stockBeforeAdjustment(it.stock ?? 0, saved, it.id).toNumber() : 0;
  const q = Number(qty) || 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!it) return;
    if (!(q > 0)) { setErr('Enter a quantity more than 0.'); return qtyRef.current?.focus(); }
    if (mode === 'reduce' && q > s) { setErr(`You only have ${qfmt(s)} ${it.unit} in stock.`); return qtyRef.current?.focus(); }
    if (track && mode === 'reduce' && !edit) {
      const have = money(batches.find((b) => (b.id ?? '') === batchId)?.qty ?? 0);
      if (have.lt(q)) { setErr(`Only ${formatQty(have)} ${it.unit} in that batch.`); return qtyRef.current?.focus(); }
    }
    try {
      const body = { itemId: it.id, mode, qty: q, rate: price || null, date, reason: why, ...(edit && { number: edit.number }), ...(track && (mode === 'add' ? { batchNo: batchNo.trim(), expiry, mfg: edit ? batchDateText(edit.mfg, 'mfg') : '' } : { batchId: batchId || null })) };
      const call = (h?: Record<string, string>) => api(edit ? `/stock-adjustments/${edit.id}` : '/stock-adjustments', { method: edit ? 'PUT' : 'POST', body, headers: h });
      if (!(edit ? await withPasscode(qc, editAsk(edit.number), call) : { value: await call() })) return;
      await Promise.all(['items', 'item', 'stock-adjustments', 'godowns', 'godown-items'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
      showToast(edit ? `${edit.number} saved` : `Stock ${mode === 'add' ? 'increased' : 'reduced'} by ${qfmt(q)} ${it.unit}`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not save the adjustment.');
    }
  }

  return (
    <div className="ov c" id="adj" ref={ovRef} hidden={!item} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'adj') close(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="adjT">
        <h3 id="adjT" style={{ margin: ui.sp('0 0 4px'), fontSize: ui.fs(18) }}>{edit ? `Edit ${edit.number}` : 'Adjust stock'}</h3>
        <p id="adjFor" style={{ margin: ui.sp('0 0 14px'), color: 'var(--t2)', fontSize: ui.fs(13) }}>{it ? (picked ? `In stock ${qfmt(s)} ${it.unit}` : `${it.name} · in stock ${qfmt(s)} ${it.unit}`) : ''}</p>
        <form id="adjForm" noValidate onSubmit={submit}>
          <label className="fl" id="adjItemRow" htmlFor="adjItem" hidden={!choices}>Item<select className="fi" id="adjItem" ref={pickRef} value={it?.id ?? ''} onChange={(e) => { const i = choices?.find((x) => x.id === e.target.value); if (!i) return; setIt(i); setPicked(true); setPrice(String(Number(i.purchase))); }}>{choices?.map((i) => <option value={i.id} key={i.id}>{i.name} · {qfmt(i.stock)} {i.unit}</option>)}</select></label>
          <div className="seg2" id="adjSeg" style={{ marginBottom: ui.sp(14) }}>
            <button type="button" data-am="add" className={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')}>Add stock</button>
            <button type="button" data-am="reduce" className={mode === 'reduce' ? 'on' : ''} onClick={() => setMode('reduce')}>Reduce stock</button>
          </div>
          {track && mode === 'reduce' ? (
            <label className="fl" htmlFor="bxAdj">Batch<select className="fi" id="bxAdj" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              {batches.some((b) => !b.id) || !batches.length ? <option value="">{batches.find((b) => !b.id) ? batchOption(batches.find((b) => !b.id)!) : 'No batch'}</option> : null}
              {batches.filter((b) => b.id).map((b) => <option value={b.id!} key={b.id}>{batchOption(b)}</option>)}
            </select></label>
          ) : track ? (
            <div className="two">
              <label className="fl" htmlFor="bxAdjNo">Batch no.<input className="fi" id="bxAdjNo" value={batchNo} placeholder="Blank = No batch" autoComplete="off" onChange={(e) => setBatchNo(e.target.value)} /></label>
              <label className="fl" htmlFor="bxAdjExp">Expiry<input className="fi" id="bxAdjExp" value={expiry} placeholder="MM/YY" autoComplete="off" onChange={(e) => setExpiry(e.target.value)} /></label>
            </div>
          ) : null}
          <div className="two">
            <label className="fl" htmlFor="adjQty">Quantity<input className="fi" id="adjQty" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} ref={qtyRef} /></label>
            <label className="fl" htmlFor="adjPrice">Price / unit<span className={cur('₹') ? 'pre2' : 'pre2 ncur'}><span>{cur('₹')}</span><input className="fi" id="adjPrice" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></span></label>
          </div>
          <div className="two">
            <label className="fl" htmlFor="adjDate">Date<input className="fi" type="date" id="adjDate" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="fl" htmlFor="adjWhy">Reason<select className="fi" id="adjWhy" value={why} onChange={(e) => setWhy(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
          </div>
          <div className="hint" id="adjAfter" style={{ margin: ui.sp('0 0 6px') }}>{q && it ? <>Stock after: <b>{qfmt(stockAfterAdjustment(s, mode, q).toNumber())} {it.unit}</b></> : ''}</div>
          <div className="msg bad" id="adjErr" role="alert">{err}</div>
          <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end' }}>
            <button className="btn" type="button" id="adjCancel" onClick={close}>Cancel</button>
            <button className="btn p" type="submit">Save adjustment</button>
          </div>
        </form>
      </div>
    </div>
  );
}
