/** Adjust stock (#adj) — same markup and checks as the prototype; saves a numbered stock adjustment. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { money } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { useCur } from '../../lib/settings';
import { today } from '../../lib/time';
import { useShell } from '../shell/store';
import { qfmt, type Item } from './ItemsPage';

const REASONS = ['Physical count correction', 'Damaged', 'Expired', 'Lost or stolen', 'Free sample / gift', 'Own use', 'Other'];

export function AdjustStockDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
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

  useEffect(() => {
    if (!item) return;
    setMode('add'); setQty(''); setPrice(String(Number(item.purchase))); setDate(today()); setWhy(REASONS[0]!); setErr('');
    setTimeout(() => qtyRef.current?.focus(), 0);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [item, onClose]);

  const s = Number(item?.stock ?? 0);
  const q = Number(qty) || 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    if (!(q > 0)) { setErr('Enter a quantity more than 0.'); return qtyRef.current?.focus(); }
    if (mode === 'reduce' && q > s) { setErr(`You only have ${qfmt(s)} ${item.unit} in stock.`); return qtyRef.current?.focus(); }
    try {
      await api('/stock-adjustments', { body: { itemId: item.id, mode, qty: q, rate: price || null, date, reason: why } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['items'] }), qc.invalidateQueries({ queryKey: ['item', item.id] }), qc.invalidateQueries({ queryKey: ['stock-adjustments'] })]);
      onClose();
      showToast(`Stock ${mode === 'add' ? 'increased' : 'reduced'} by ${qfmt(q)} ${item.unit}`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not save the adjustment.');
    }
  }

  return (
    <div className="ov c" id="adj" hidden={!item} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'adj') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="adjT">
        <h3 id="adjT" style={{ margin: '0 0 4px', fontSize: 18 }}>Adjust stock</h3>
        <p id="adjFor" style={{ margin: '0 0 14px', color: 'var(--t2)', fontSize: 13 }}>{item ? `${item.name} · in stock ${qfmt(s)} ${item.unit}` : ''}</p>
        <form id="adjForm" noValidate onSubmit={submit}>
          <label className="fl" id="adjItemRow" htmlFor="adjItem" hidden>Item<select className="fi" id="adjItem"></select></label>
          <div className="seg2" id="adjSeg" style={{ marginBottom: 14 }}>
            <button type="button" data-am="add" className={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')}>Add stock</button>
            <button type="button" data-am="reduce" className={mode === 'reduce' ? 'on' : ''} onClick={() => setMode('reduce')}>Reduce stock</button>
          </div>
          <div className="two">
            <label className="fl" htmlFor="adjQty">Quantity<input className="fi" id="adjQty" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} ref={qtyRef} /></label>
            <label className="fl" htmlFor="adjPrice">Price / unit<span className={cur('₹') ? 'pre2' : 'pre2 ncur'}><span>{cur('₹')}</span><input className="fi" id="adjPrice" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></span></label>
          </div>
          <div className="two">
            <label className="fl" htmlFor="adjDate">Date<input className="fi" type="date" id="adjDate" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="fl" htmlFor="adjWhy">Reason<select className="fi" id="adjWhy" value={why} onChange={(e) => setWhy(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
          </div>
          <div className="hint" id="adjAfter" style={{ margin: '0 0 6px' }}>{q && item ? <>Stock after: <b>{qfmt(money(s).plus(mode === 'add' ? q : -q).toNumber())} {item.unit}</b></> : ''}</div>
          <div className="msg bad" id="adjErr" role="alert">{err}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" type="button" id="adjCancel" onClick={onClose}>Cancel</button>
            <button className="btn p" type="submit">Save adjustment</button>
          </div>
        </form>
      </div>
    </div>
  );
}
