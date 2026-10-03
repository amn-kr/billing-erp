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

/** `choices` set: opened from Stock adjustments › New adjustment, with the item picker shown (first item chosen). */
export function AdjustStockDialog({ item, choices, onClose }: { item: Item | null; choices?: Item[]; onClose: () => void }) {
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
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    if (!item) return;
    setIt(item); setPicked(false);
    setMode('add'); setQty(''); setPrice(String(Number(item.purchase))); setDate(today()); setWhy(REASONS[0]!); setErr('');
    setTimeout(() => (choices ? pickRef.current : qtyRef.current)?.focus(), 0);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, onClose]);

  const s = Number(it?.stock ?? 0);
  const q = Number(qty) || 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!it) return;
    if (!(q > 0)) { setErr('Enter a quantity more than 0.'); return qtyRef.current?.focus(); }
    if (mode === 'reduce' && q > s) { setErr(`You only have ${qfmt(s)} ${it.unit} in stock.`); return qtyRef.current?.focus(); }
    try {
      await api('/stock-adjustments', { body: { itemId: it.id, mode, qty: q, rate: price || null, date, reason: why } });
      await Promise.all(['items', 'item', 'stock-adjustments', 'godowns', 'godown-items'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
      showToast(`Stock ${mode === 'add' ? 'increased' : 'reduced'} by ${qfmt(q)} ${it.unit}`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not save the adjustment.');
    }
  }

  return (
    <div className="ov c" id="adj" hidden={!item} onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).id === 'adj') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="adjT">
        <h3 id="adjT" style={{ margin: '0 0 4px', fontSize: 18 }}>Adjust stock</h3>
        <p id="adjFor" style={{ margin: '0 0 14px', color: 'var(--t2)', fontSize: 13 }}>{it ? (picked ? `In stock ${qfmt(s)} ${it.unit}` : `${it.name} · in stock ${qfmt(s)} ${it.unit}`) : ''}</p>
        <form id="adjForm" noValidate onSubmit={submit}>
          <label className="fl" id="adjItemRow" htmlFor="adjItem" hidden={!choices}>Item<select className="fi" id="adjItem" ref={pickRef} value={it?.id ?? ''} onChange={(e) => { const i = choices?.find((x) => x.id === e.target.value); if (!i) return; setIt(i); setPicked(true); setPrice(String(Number(i.purchase))); }}>{choices?.map((i) => <option value={i.id} key={i.id}>{i.name} · {qfmt(i.stock)} {i.unit}</option>)}</select></label>
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
          <div className="hint" id="adjAfter" style={{ margin: '0 0 6px' }}>{q && it ? <>Stock after: <b>{qfmt(money(s).plus(mode === 'add' ? q : -q).toNumber())} {it.unit}</b></> : ''}</div>
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
