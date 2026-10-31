/**
 * Quick sale (prototype #qsm, header ⚡ / Alt+N): a short bill in a window. The number shown
 * is the next one; it is only taken when the bill is saved.
 */
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaleInput } from '@billing/shared';
import { RawIcon } from '../../components/Icon';
import { api, ApiError } from '../../lib/api';
import { fmtD, inr, inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { useEscape } from '../../lib/useEscape';
import { toastSaveFailed, toastSaved } from '../shell/saved';
import { qfmt } from '../items/ItemsPage';
import { useEditorData, type EditorData } from './editor/data';
import { ComboList, comboKey, partyOpts, useCombo, type ComboOpt } from './editor/Grid';
import { calc, lineFor, newSI, partyState, priceListFor, unitPrice, useSI, type EItem, type EParty, type Line } from './editor/state';
import { ui } from '../../styles/uiSize';

export const useQuick = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({ open: false, show: () => set({ open: true }), hide: () => set({ open: false }) }));

const BOLT = '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>';
const FULL = '<path d="M14 4h6v6M20 4l-8 8M10 6H5v13h13v-5"/>';
const X = '<path d="M6 6l12 12M18 6L6 18"/>';
const PRINT = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';
const SAVE = '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>';
type Pay = 'Cash' | 'UPI' | 'Card' | 'Credit';
const blank = (): Line => ({ item: null, name: '', hsn: '', qty: 1, unit: '', price: 0, disc: 0, gst: 0 });

export function QuickSale() {
  const { open, hide } = useQuick();
  const d = useEditorData();
  if (!open || !d) return null;
  return <QuickSaleWindow d={d} close={hide} />;
}

function QuickSaleWindow({ d, close }: { d: EditorData; close: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const date = today();
  const nn = useQuery({ queryKey: ['next-number', 'sale', date], queryFn: () => api<{ number: string }>(`/sales/next-number?kind=invoice&date=${date}`) });
  const [party, setParty] = useState<EParty | null>(null);
  const [name, setName] = useState('');
  const [pay, setPay] = useState<Pay>('Cash');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const c = useCombo();
  const ref = useRef<HTMLDivElement>(null);
  useEscape(true, close);
  useEffect(() => { setTimeout(() => document.getElementById('qsParty')?.focus(), 40); }, []);
  const ctx = d.ctx;
  // totals like an invoice with prices including GST and round off (prototype qsCalc)
  const si = { ...newSI(ctx, { no: '', date }), party, pos: party ? partyState(ctx, party) : ctx.state, lines };
  const t = calc(ctx, si);
  const n = lines.filter((l) => l.item).length;
  const pl = priceListFor(ctx, party);
  const plName = pl && pl !== ctx.defaultList ? ctx.listName[pl] : '';

  const itemOpts = (q: string): ComboOpt[] => {
    const s = q.toLowerCase();
    return d.IT.filter((i) => !s || i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s) || i.brand.toLowerCase().includes(s)).slice(0, 30).map((i) => ({
      val: i,
      html: <><span><b>{i.name}</b><small>{i.code ? i.code + ' · ' : ''}{i.svc ? 'Service' : `Stock ${qfmt(i.stock ?? 0)} ${i.unit}`}</small></span><span><b>{inr2f(unitPrice(ctx, i, party))}</b>{i.stock !== null && i.stock <= 0 ? <small className="neg">Out of stock</small> : null}</span></>,
    }));
  };
  const pOpts = (q: string) => partyOpts(d.PT, q).filter((o) => o.val !== '__add');
  const pickParty = (p: EParty | null) => {
    setParty(p); setName('');
    if (!p && pay === 'Credit') setPay('Cash');
    setLines((L) => L.map((l) => (l.item ? { ...l, price: unitPrice(ctx, l.item, p) } : l)));
    c.hide();
    if (p) setTimeout(() => document.querySelector<HTMLInputElement>('#qsRows .qs-item')?.focus(), 0);
  };
  const pickItem = (i: number, it: EItem) => {
    setLines((L) => {
      const next = [...L];
      next[i] = { ...next[i]!, item: it, name: it.name, hsn: it.hsn || '', unit: it.unit, price: unitPrice(ctx, it, party), gst: ctx.mode === 'gst' ? it.gst || 0 : 0 };
      if (i === L.length - 1) next.push(blank());
      return next;
    });
    c.hide();
    setTimeout(() => { const q = document.querySelector<HTMLInputElement>(`#qsRows [data-qi="${i}"] .qsq`); q?.focus(); q?.select(); }, 0);
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines((L) => L.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const save = async (print: boolean) => {
    const fail = (m: string) => { setErr(m); toastSaveFailed(m); };
    setErr('');
    const L = lines.filter((l) => l.item || l.name.trim());
    if (!L.length) { fail('Add at least one item.'); return document.querySelector<HTMLInputElement>('#qsRows .qs-item')?.focus(); }
    const unk = L.find((l) => !l.item);
    if (unk) return fail(`Pick “${unk.name}” from the list.`);
    const bad = L.find((l) => !(Number(l.qty) > 0));
    if (bad) return fail(`Enter a quantity for ${bad.name}.`);
    if (pay === 'Credit' && !party) return fail('Choose a party for a credit sale.');
    const credit = pay === 'Credit';
    const body: SaleInput = {
      kind: 'invoice', number: '', date, dueDate: credit && party ? new Date(Date.parse(date + 'T00:00:00Z') + (party.days || 0) * 864e5).toISOString().slice(0, 10) : date,
      mode: party ? 'credit' : 'cash', partyId: party?.id ?? null, cashName: party ? '' : name.trim() || 'Walk-in customer', cashPhone: '', billName: '',
      placeOfSupply: party ? partyState(ctx, party) : ctx.state, pricesInclTax: true, roundOff: true, billDiscPct: null, billDiscAmt: null, transport: '0', labour: '0', bankCharge: '0',
      lines: L.map((l) => ({ itemId: l.item!.id, name: l.name, hsn: l.hsn, qty: String(l.qty), unit: l.unit, price: String(l.price), discPct: String(l.disc || 0), gstRate: String(l.gst || 0), basePrice: null, commOverride: null })),
      payments: credit ? [] : [{ mode: pay, amount: String(t.total), ref: '' }], notes: 'Thank you for your business.',
      extra: { challanNo: '', poNo: '', poDate: '', ewb: '', transport: '', vehicle: '', deliveryDate: '', description: '', attachments: [], quoteRefs: [], validTill: '', commByCategory: {} },
      referrerId: null, fromQuotationIds: [], fromChallanId: null, confirmOverLimit: true,
    };
    setBusy(true);
    try {
      const r = await api<{ id: string; number: string; total: string }>('/sales', { method: 'POST', body });
      await Promise.all(['sales', 'parties', 'items', 'receipts', 'next-number', 'dues'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      close();
      toastSaved('invoice');
      if (print) navigate('/sales', { state: { preview: r.id, print: true } });
    } catch (e) { fail(e instanceof ApiError ? e.message : 'Could not save the bill.'); } finally { setBusy(false); }
  };
  /* Open full invoice: the same party and items in a new bill tab of the editor */
  const full = () => {
    const s = newSI(ctx, { no: nn.data?.number ?? '', date });
    if (party) { s.party = party; s.pos = partyState(ctx, party); s.due = s.date; }
    s.lines = [...lines.filter((l) => l.item).map((l) => ({ ...lineFor(ctx, s, l.item!), qty: Number(l.qty) || 1, price: l.price, disc: Number(l.disc) || 0 })), { item: null, name: '', hsn: '', qty: 1, unit: '', price: 0, disc: 0, gst: 18 }];
    useSI.getState().open(s);
    close();
    navigate(`/sales/new?keep=${Date.now()}`);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const tEl = e.target as HTMLInputElement;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); void save(e.shiftKey); return; }
    if (c.cb && comboKey(c, e)) return;
    if (e.key === 'Enter' && tEl.id === 'qsParty') { e.preventDefault(); c.hide(); document.querySelector<HTMLInputElement>('#qsRows .qs-item')?.focus(); return; }
    if (e.key === 'Enter' && tEl.dataset.qf) {
      e.preventDefault();
      const r = tEl.closest<HTMLElement>('[data-qi]')!, i = Number(r.dataset.qi);
      if (tEl.dataset.qf === 'qty') r.querySelector<HTMLInputElement>('.qsd')?.focus();
      else document.querySelector<HTMLInputElement>(`#qsRows [data-qi="${i + 1}"] .qs-item`)?.focus();
    }
  };
  const blur = () => setTimeout(() => { const a = document.activeElement; if (!a?.closest?.('#qsm .combo')) c.hide(); }, 120);

  return (
    <div className="ov c" id="qsm" ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'qsm') close(); }} onKeyDownCapture={onKey}>
      <div className="mdl qsmd" role="dialog" aria-modal="true" aria-labelledby="qsT">
        <div className="qsh"><div><h3 id="qsT"><span className="qsbolt"><RawIcon d={BOLT} /></span>Quick sale</h3><small className="mu"><span className="mono" id="qsNo">{nn.data?.number ?? ''}</span> · <span id="qsDate">{fmtD(date)}</span></small></div>
          <div style={{ display: 'flex', gap: ui.sp(6) }}><button className="ib" type="button" id="qsFull" title="Open full invoice" aria-label="Open full invoice" onClick={full}><RawIcon d={FULL} /></button><button className="ib" type="button" id="qsClose" aria-label="Close" onClick={close}><RawIcon d={X} /></button></div></div>
        <label className="fl" htmlFor="qsParty">Party name<div className="combo"><input className="fi" id="qsParty" placeholder="Search party or type a name" autoComplete="off" value={party ? party.name : name}
          onChange={(e) => { setParty(null); setName(e.target.value); if (pay === 'Credit') setPay('Cash'); c.show('qsp', pOpts(e.target.value), (v) => pickParty(v as EParty)); }}
          onFocus={(e) => { if (!party) c.show('qsp', pOpts(e.target.value), (v) => pickParty(v as EParty)); }} onBlur={blur} /><ComboList c={c} k="qsp" /></div></label>
        <small className="qspi" id="qsPInfo">{party ? <>{party.phone ? `+91 ${party.phone} · ` : ''}Balance <b className={party.balance > 0 ? 'pos' : party.balance < 0 ? 'neg' : ''}>{inr(Math.abs(party.balance))}</b>{plName ? <> · <span className="st b">{plName}</span></> : null}</> : name ? 'New walk-in customer (cash sale)' : 'Leave empty for a walk-in cash sale'}</small>
        <div className="qsrh"><span>Item</span><span className="n">Qty</span><span className="n">Disc %</span><span className="n">Amount</span><span></span></div>
        <div id="qsRows">{lines.map((l, i) => {
          const st = l.item && !l.item.svc ? l.item.stock ?? 0 : null;
          return (
            <div className="qsr" data-qi={i} key={i}>
              <div className="qsit"><div className="combo"><input className="fi qs-item" value={l.name} placeholder="Search item" autoComplete="off" aria-label={`Item ${i + 1}`}
                onChange={(e) => { setLine(i, { name: e.target.value, item: null }); c.show(`qi${i}`, itemOpts(e.target.value), (v) => pickItem(i, v as EItem)); }}
                onFocus={(e) => { if (!l.item) c.show(`qi${i}`, itemOpts(e.target.value), (v) => pickItem(i, v as EItem)); }} onBlur={blur} /><ComboList c={c} k={`qi${i}`} /></div>
                {l.item ? <small>@ {inr2f(l.price)}{st !== null ? <> · <span className={st < (Number(l.qty) || 0) ? 'neg' : ''}>{qfmt(st)} {l.unit} in stock</span></> : null}</small> : null}</div>
              <input className="fi n qsq" data-qf="qty" value={String(l.qty)} inputMode="decimal" aria-label="Quantity" onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} />
              <input className="fi n qsd" data-qf="disc" value={l.disc || ''} placeholder="0" inputMode="decimal" aria-label="Discount %" onChange={(e) => setLine(i, { disc: (e.target.value.replace(/[^\d.]/g, '') as unknown as number) })} />
              <b className="qsa" data-qa>{inr2f(t.rows[i]!.amt)}</b>
              <button type="button" className="ix" data-qsdel={i} aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((L) => (L.length > 1 ? L.filter((_, k) => k !== i) : [blank()]))}><RawIcon d={X} /></button></div>
          );
        })}</div>
        <button type="button" className="lnk qsadd" id="qsAdd" onClick={() => { setLines((L) => [...L, blank()]); setTimeout(() => [...document.querySelectorAll<HTMLInputElement>('#qsRows .qs-item')].pop()?.focus(), 0); }}>+ Add another item</button>
        <div className="qstot" id="qsTotal"><span>{n} item{n === 1 ? '' : 's'}{t.tax ? ` · incl. GST ${inr2f(t.tax)}` : ''}</span><b>₹{inr2f(t.total)}</b></div>
        <div className="qsfoot"><div><small className="mu" style={{ display: 'block', marginBottom: ui.sp(6) }}>Payment type</small><div className="seg2 sm" id="qsPay" role="group" aria-label="Payment type">
          {(['Cash', 'UPI', 'Card', 'Credit'] as Pay[]).map((m) => <button type="button" className={pay === m ? 'on' : ''} data-qspay={m} key={m} disabled={m === 'Credit' && !party} title={m === 'Credit' && !party ? 'Choose a party for a credit sale' : undefined} onClick={() => setPay(m)}>{m}</button>)}</div></div>
          <div className="qsbtns"><div className="msg bad" id="qsErr" role="alert" style={{ margin: 0 }}>{err}</div><button className="ib qsib" type="button" id="qsPrint" title="Save & print (Ctrl+Shift+S)" aria-label="Save and print" disabled={busy} onClick={() => void save(true)}><RawIcon d={PRINT} /></button><button className="ib qsib p" type="button" id="qsSave" title="Save (Ctrl+S)" aria-label="Save" disabled={busy} onClick={() => void save(false)}><RawIcon d={SAVE} /></button></div></div>
      </div>
    </div>
  );
}
