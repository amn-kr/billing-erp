/**
 * Purchase lists — the prototype's renderPur (#vPur), renderPos (#vPos),
 * renderPmade (#vPmade) and renderDns (#vDns). A row opens the document view
 * (#pvm); "Pay" and "Record payment" open the payment window (#ppm).
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { money } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { today as todayIst } from '../../lib/time';
import { useFitTables } from '../../lib/useFitTables';
import { RawIcon } from '../../components/Icon';
import { ThfChoices, ThfPop, type ThfAnchor } from '../../components/ThfPop';
import { useShell } from '../shell/store';
import { inPeriod, type Period } from '../sales/model';
import { RangeForm } from '../sales/SalesPage';
import { PU_KEYS, statusOfBill, usePaymentsMade, usePurchases, type PurchaseRow } from './model';
import { PayDialog, type PayOpen } from './PayDialog';
import { PurchaseView } from './PurchaseView';
import { cancelAsk, withPasscode } from '../settings/passcode';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const FILTER = '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const UP = '<path d="M12 20V9M7 13l5-5 5 5"/>';
const KBD = { marginLeft: 6, background: 'transparent', color: 'inherit', borderColor: 'rgba(255,255,255,.4)' };
const PER: [Period, string][] = [['all', 'All dates'], ['oct', 'This month'], ['sep', 'Last month'], ['custom', 'Custom range…']];
const fmShort = (x?: string) => (x ? new Date(x + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '…');
const NEW = <> <span className="st b" style={{ fontSize: 10, padding: '1px 6px' }}>New</span></>;

/** A column-head filter button over a hidden <select> (prototype thf). */
function Thf({ id, label, on, title, onOpen }: { id: string; label: string; on: boolean; title: string; onOpen: (el: HTMLElement) => void }) {
  return <button type="button" className={`thf${on ? ' on' : ''}`} data-thf={id} aria-label={label} title={on ? `Filtered: ${title}` : label} aria-haspopup="true" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpen(e.currentTarget); }}><RawIcon d={FILTER} /></button>;
}

/** Row keys: Enter opens the document, as a click does. */
const rowKeys = (sel: string) => (e: React.KeyboardEvent) => { const r = (e.target as HTMLElement).closest<HTMLElement>(sel); if (r && e.key === 'Enter' && e.target === r) { e.preventDefault(); r.click(); } };

function usePeriodPop() {
  const [per, setPer] = useState<Period>('all');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [pop, setPop] = useState<{ kind: string; anchor: ThfAnchor } | null>(null);
  const closePop = useCallback((refocus: boolean) => setPop((p) => { if (refocus) (p?.anchor.el as HTMLElement | undefined)?.focus(); return null; }), []);
  const perOpts: [string, string][] = PER.map(([v, t]) => [v, v === 'custom' && per === 'custom' ? `${fmShort(range.from)} – ${fmShort(range.to)}` : t]);
  const toggle = (kind: string) => (el: HTMLElement) => setPop((p) => (p && p.anchor.el === el ? null : { kind, anchor: { el } }));
  const perPop = pop?.kind === 'per' ? <ThfChoices options={perOpts} value={per} onPick={(v) => { if (v === 'custom') setPop({ kind: 'range', anchor: pop.anchor }); else { setPer(v as Period); setPop(null); } }} />
    : pop?.kind === 'range' ? <RangeForm initial={range} today={todayIst()} onBack={() => setPop({ kind: 'per', anchor: pop.anchor })} onApply={(r) => { setRange(r); setPer('custom'); setPop(null); }} /> : null;
  return { per, setPer, range, pop, setPop, closePop, perOpts, toggle, perPop };
}

/* ───────── Purchase bills ───────── */
const ST: [string, string][] = [['all', 'All statuses'], ['open', 'Unpaid'], ['over', 'Overdue'], ['paid', 'Paid']];

export function PurchaseBillsPage() {
  useFitTables();
  const navigate = useNavigate();
  const list = usePurchases('bill');
  const [q, setQ] = useState('');
  const [st, setSt] = useState('all');
  const P = usePeriodPop();
  const [pay, setPay] = useState<PayOpen | null>(null);
  const [view, setView] = useState<string | null>(null);
  if (!list.data) return <section id="vPur"></section>;
  const A = list.data.filter((b) => inPeriod(b.date, P.per, P.range));
  const live = A.filter((b) => !b.cancelled);
  const tot = live.reduce((a, b) => a.plus(b.total), money(0));
  const due = live.reduce((a, b) => a.plus(b.balance), money(0));
  const over = live.filter((b) => statusOfBill(b).t.startsWith('Overdue')).reduce((a, b) => a.plus(b.balance), money(0));
  const s = q.toLowerCase();
  const L = A.filter((b) => {
    const t = statusOfBill(b).t, bal = Number(b.balance);
    return (st === 'all' || (st === 'paid' ? bal <= 0 && !b.cancelled : st === 'over' ? t.startsWith('Overdue') : bal > 0)) && (!s || b.number.toLowerCase().includes(s) || b.supplierRef.toLowerCase().includes(s) || b.partyName.toLowerCase().includes(s));
  });
  const newBill = () => navigate('/purchases/new?kind=bill');
  return (
    <section id="vPur">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Purchase bills</h1><div className="sp"></div><button className="btn" data-paynew="1" onClick={() => setPay({})}><RawIcon d={UP} />Record payment</button><button className="btn p" data-pnew="bill" onClick={newBill}><RawIcon d={PLUS} />New purchase bill <kbd className="kh" style={KBD}>Alt+P</kbd></button></div>
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><label className="search" htmlFor="puQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="puQ" placeholder="Search bill no., supplier or their bill no." autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="sumrow sumin" id="puSum"><div><small>Purchases</small><b>{inr(tot.toFixed(2))}</b></div><div><small>Paid</small><b className="pos">{inr(tot.minus(due).toFixed(2))}</b></div><div><small>To pay</small><b className="neg">{inr(due.toFixed(2))}</b></div><div><small>Overdue</small><b className={over.gt(0) ? 'neg' : ''}>{inr(over.toFixed(2))}</b></div></div>
          <div className="seg2 sm" id="puPer" hidden>{(['all', 'oct', 'sep'] as const).map((k) => <button data-per={k} className={P.per === k ? 'on' : ''} key={k} onClick={() => P.setPer(k)}>{k === 'all' ? 'All' : k === 'oct' ? 'This month' : 'Last month'}</button>)}</div>
          <select id="puPerSel" hidden aria-hidden="true" value={P.per} onChange={(e) => P.setPer(e.target.value as Period)}>{P.perOpts.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select>
          <select className="fi" hidden id="puSt" aria-label="Filter by status" value={st} onChange={(e) => setSt(e.target.value)}>{ST.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr>
          <th><span className="thw2">Date<Thf id="puPerSel" label="Filter by date" on={P.per !== 'all'} title={P.perOpts.find((o) => o[0] === P.per)?.[1] ?? ''} onOpen={P.toggle('per')} /></span></th><th>Bill no.</th><th>Supplier bill</th><th>Supplier</th><th className="n">Total</th><th className="n">Paid</th><th className="n">Balance</th><th>Due date</th>
          <th><span className="thw2">Status<Thf id="puSt" label="Filter by status" on={st !== 'all'} title={ST.find((o) => o[0] === st)?.[1] ?? ''} onOpen={P.toggle('st')} /></span></th><th><span className="vh">Pay</span></th></tr></thead>
          <tbody id="puRows" onKeyDown={rowKeys('tr[data-bno]')}>
            {L.length ? L.map((b) => {
              const bal = Number(b.balance), stt = statusOfBill(b);
              return (
                <tr tabIndex={0} data-bno={b.number} className={b.cancelled ? 'slcan' : undefined} key={b.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setView(b.id); }}><td>{dmy(b.date)}</td><td className="mono">{b.number}{b.cancelled ? null : NEW}</td><td className="mono mu">{b.supplierRef || '—'}</td><td><b style={{ fontWeight: 600 }}>{b.partyName}</b></td>
                  <td className="n">{inr2f(b.total)}</td><td className="n">{inr2f(b.paid)}</td><td className="n">{inr2f(b.balance)}</td><td>{bal > 0 && b.dueDate ? dmy(b.dueDate) : ''}</td><td><span className={`stt ${stt.c}`}>{stt.t}</span></td>
                  <td className="n">{bal > 0 ? <button className="btn sm" data-paybill={b.number} onClick={(e) => { e.stopPropagation(); setPay({ party: b.party.id, bill: b.id }); }}>Pay</button> : null}</td></tr>
              );
            }) : <tr><td colSpan={10} className="ptempty">No purchase bills match. <button className="lnk" data-pnew="bill" onClick={newBill}>Record a purchase bill</button></td></tr>}
          </tbody></table></div>
      </div>
      <ThfPop anchor={P.pop?.anchor ?? null} onClose={P.closePop} focus={P.pop?.kind === 'range' ? '#thdFrom' : 'button.on,button'}>
        {P.perPop}
        {P.pop?.kind === 'st' ? <ThfChoices options={ST} value={st} onPick={(v) => { setSt(v); P.setPop(null); }} /> : null}
      </ThfPop>
      <PurchaseView id={view} onClose={() => setView(null)} onPay={(o) => { setView(null); setPay(o); }} />
      <PayDialog open={pay} onClose={() => setPay(null)} />
    </section>
  );
}

/* ───────── Purchase orders ───────── */
const PO_ST: [string, string][] = [['all', 'All orders'], ['open', 'Open'], ['received', 'Received'], ['cancelled', 'Cancelled']];
const PO_S: Record<string, { t: string; c: string }> = { open: { t: 'Open', c: 'b' }, received: { t: 'Received', c: 'g' }, cancelled: { t: 'Cancelled', c: 'x' } };

export function PurchaseOrdersPage() {
  useFitTables();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const list = usePurchases('order');
  const [q, setQ] = useState('');
  const [st, setSt] = useState('all');
  const [sure, setSure] = useState<string | null>(null);
  const P = usePeriodPop();
  const [view, setView] = useState<string | null>(null);
  if (!list.data) return <section id="vPos"></section>;
  const A = list.data;
  const open = A.filter((d) => d.status === 'open');
  const val = open.reduce((a, d) => a.plus(d.total), money(0));
  const s = q.toLowerCase();
  const L = A.filter((d) => (st === 'all' || d.status === st) && (!s || d.number.toLowerCase().includes(s) || d.partyName.toLowerCase().includes(s)));
  const today = todayIst();
  const newPo = () => navigate('/purchases/new?kind=order');
  const convert = (d: PurchaseRow) => navigate(`/purchases/new?kind=bill&order=${d.id}`);
  const cancel = async (d: PurchaseRow) => {
    if (sure !== d.id) { setSure(d.id); setTimeout(() => setSure((x) => (x === d.id ? null : x)), 2500); return; }
    setSure(null);
    try {
      if (!(await withPasscode(qc, cancelAsk(d.number, 'order'), (h) => api(`/purchases/${d.id}/cancel`, { method: 'POST', body: {}, headers: h })))) return;
      await Promise.all(PU_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`${d.number} cancelled`);
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not cancel the order.'); }
  };
  return (
    <section id="vPos">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Purchase orders</h1><div className="sp"></div><button className="btn p" data-pnew="po" onClick={newPo}><RawIcon d={PLUS} />New purchase order</button></div>
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><label className="search" htmlFor="poQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="poQ" placeholder="Search order no. or supplier" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="sumrow sumin" id="poSum"><div><small>Open orders</small><b>{open.length}</b></div><div><small>Open value</small><b>{inr(val.toFixed(2))}</b></div><div><small>Received</small><b className="pos">{A.filter((d) => d.status === 'received').length}</b></div><div><small>Cancelled</small><b>{A.filter((d) => d.status === 'cancelled').length}</b></div></div>
          <select className="fi" hidden id="poSt" aria-label="Filter by status" value={st} onChange={(e) => setSt(e.target.value)}>{PO_ST.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Order no.</th><th>Supplier</th><th>Expected</th><th className="n">Items</th><th className="n">Amount</th>
          <th><span className="thw2">Status<Thf id="poSt" label="Filter by status" on={st !== 'all'} title={PO_ST.find((o) => o[0] === st)?.[1] ?? ''} onOpen={P.toggle('st')} /></span></th><th><span className="vh">Actions</span></th></tr></thead>
          <tbody id="poRows" onKeyDown={rowKeys('tr[data-pono]')}>
            {L.length ? L.map((d) => {
              const late = d.status === 'open' && !!d.dueDate && d.dueDate < today;
              return (
                <tr tabIndex={0} data-pono={d.number} key={d.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setView(d.id); }}><td>{dmy(d.date)}</td><td className="mono">{d.number}</td><td><b style={{ fontWeight: 600 }}>{d.partyName}</b></td><td className={late ? 'neg' : ''}>{d.dueDate ? dmy(d.dueDate) : '—'}{late ? ' · late' : ''}</td><td className="n">{d.items}</td><td className="n">{inr2f(d.total)}</td>
                  <td><span className={`stt ${PO_S[d.status]!.c}`}>{PO_S[d.status]!.t}</span>{d.bill ? <small className="mu" style={{ display: 'block' }}>{d.bill}</small> : null}</td>
                  <td className="n" style={{ whiteSpace: 'nowrap' }}>{d.status === 'open' ? <><button className="btn p sm" data-poconv={d.number} onClick={() => convert(d)}>Convert to bill</button> <button className="btn sm" data-pocancel={d.number} onClick={() => void cancel(d)}>{sure === d.id ? 'Click again to cancel' : 'Cancel'}</button></> : null}</td></tr>
              );
            }) : <tr><td colSpan={8} className="ptempty">No purchase orders. <button className="lnk" data-pnew="po" onClick={newPo}>Create a purchase order</button></td></tr>}
          </tbody></table></div>
      </div>
      <ThfPop anchor={P.pop?.anchor ?? null} onClose={P.closePop} focus="button.on,button">
        {P.pop?.kind === 'st' ? <ThfChoices options={PO_ST} value={st} onPick={(v) => { setSt(v); P.setPop(null); }} /> : null}
      </ThfPop>
      <PurchaseView id={view} onClose={() => setView(null)} />
    </section>
  );
}

/* ───────── Payments made ───────── */
export function PaymentsMadePage() {
  useFitTables();
  const list = usePaymentsMade();
  const bills = usePurchases('bill');
  const [q, setQ] = useState('');
  const P = usePeriodPop();
  const [pay, setPay] = useState<PayOpen | null>(null);
  // "Payment made" from the + menu
  const [params, setParams] = useSearchParams();
  useEffect(() => { if (params.get('new')) { setPay({}); setParams({}, { replace: true }); } }, [params, setParams]);
  if (!list.data || !bills.data) return <section id="vPmade"></section>;
  const A = list.data.filter((x) => !x.cancelled && inPeriod(x.date, P.per, P.range));
  const tot = A.reduce((a, x) => a.plus(x.amount), money(0));
  const adv = A.reduce((a, x) => a.plus(x.unused), money(0));
  const toPay = bills.data.reduce((a, b) => a.plus(b.balance), money(0));
  const s = q.toLowerCase();
  const L = A.filter((x) => !s || x.number.toLowerCase().includes(s) || x.partyName.toLowerCase().includes(s) || x.ref.toLowerCase().includes(s));
  return (
    <section id="vPmade">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Payments made</h1><div className="sp"></div><button className="btn p" id="pxNew" onClick={() => setPay({})}><RawIcon d={PLUS} />Record payment</button></div>
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><label className="search" htmlFor="pxQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="pxQ" placeholder="Search payment no., supplier or reference" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="sumrow sumin" id="pxSum"><div><small>Paid out</small><b>{inr(tot.toFixed(2))}</b></div><div><small>Payments</small><b>{A.length}</b></div><div><small>Advance (unused)</small><b>{inr(adv.toFixed(2))}</b></div><div><small>To pay now</small><b className="neg">{inr(toPay.toFixed(2))}</b></div></div>
          <div className="seg2 sm" id="pxPer" hidden>{(['all', 'oct', 'sep'] as const).map((k) => <button data-per={k} className={P.per === k ? 'on' : ''} key={k} onClick={() => P.setPer(k)}>{k === 'all' ? 'All' : k === 'oct' ? 'This month' : 'Last month'}</button>)}</div>
          <select id="pxPerSel" hidden aria-hidden="true" value={P.per} onChange={(e) => P.setPer(e.target.value as Period)}>{P.perOpts.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th><span className="thw2">Date<Thf id="pxPerSel" label="Filter by date" on={P.per !== 'all'} title={P.perOpts.find((o) => o[0] === P.per)?.[1] ?? ''} onOpen={P.toggle('per')} /></span></th><th>Payment no.</th><th>Supplier</th><th>Mode</th><th>Reference</th><th>Against bills</th><th className="n">Amount</th></tr></thead>
          <tbody id="pxRows">
            {L.length ? L.map((x) => (
              <tr key={x.id}><td>{dmy(x.date)}</td><td className="mono">{x.number}{NEW}</td><td><b style={{ fontWeight: 600 }}>{x.partyName || '—'}</b></td><td>{x.mode}</td><td className="mono mu">{x.ref || '—'}</td>
                <td>{x.bills.length ? x.bills.map((b, k) => <span key={b.number}>{k ? ', ' : ''}<span className="mono">{b.number}</span></span>) : <span className="st a">Advance</span>}</td><td className="n"><b>{inr2f(x.amount)}</b></td></tr>
            )) : <tr><td colSpan={7} className="ptempty">No payments yet. <button className="lnk" data-paynew="1" onClick={() => setPay({})}>Record a payment</button></td></tr>}
          </tbody></table></div>
      </div>
      <ThfPop anchor={P.pop?.anchor ?? null} onClose={P.closePop} focus={P.pop?.kind === 'range' ? '#thdFrom' : 'button.on,button'}>{P.perPop}</ThfPop>
      <PayDialog open={pay} onClose={() => setPay(null)} />
    </section>
  );
}

/* ───────── Debit notes ───────── */
export function DebitNotesPage() {
  useFitTables();
  const navigate = useNavigate();
  const list = usePurchases('debit_note');
  const [q, setQ] = useState('');
  const [view, setView] = useState<string | null>(null);
  if (!list.data) return <section id="vDns"></section>;
  const A = list.data.filter((d) => !d.cancelled);
  const tot = A.reduce((a, d) => a.plus(d.total), money(0));
  const qty = A.reduce((a, d) => a.plus(d.qty), money(0));
  const s = q.toLowerCase();
  const L = A.filter((d) => !s || d.number.toLowerCase().includes(s) || d.partyName.toLowerCase().includes(s));
  const newDn = () => navigate('/purchases/new?kind=debit_note');
  return (
    <section id="vDns">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Debit notes</h1><span className="pttot">Goods returned to suppliers</span><div className="sp"></div><button className="btn p" data-pnew="dn" onClick={newDn}><RawIcon d={PLUS} />New debit note</button></div>
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><label className="search" htmlFor="dnQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="dnQ" placeholder="Search debit note or supplier" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="sumrow sumin" id="dnSum"><div><small>Returned to suppliers</small><b>{inr(tot.toFixed(2))}</b></div><div><small>Debit notes</small><b>{A.length}</b></div><div><small>Items returned</small><b>{Number(qty.toFixed(3)).toLocaleString('en-IN')}</b></div><div><small>Unused credit</small><b>{inr(A.reduce((a, d) => a.plus(d.balance), money(0)).toFixed(2))}</b></div></div></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Debit note</th><th>Supplier</th><th>Against bill</th><th>Reason</th><th className="n">Qty</th><th className="n">Amount</th></tr></thead>
          <tbody id="dnRows" onKeyDown={rowKeys('tr[data-dnno]')}>
            {L.length ? L.map((d) => (
              <tr tabIndex={0} data-dnno={d.number} key={d.id} onClick={() => setView(d.id)}><td>{dmy(d.date)}</td><td className="mono">{d.number}</td><td><b style={{ fontWeight: 600 }}>{d.partyName || '—'}</b></td><td className="mono">{d.against || '—'}</td><td>{d.reason || '—'}</td><td className="n">{Number(d.qty)}</td><td className="n"><b>{inr2f(d.total)}</b></td></tr>
            )) : <tr><td colSpan={7}><div className="ptempty pue"><b>No debit notes yet</b><span>When you return damaged or extra goods to a supplier, record a debit note. Stock goes down and the supplier’s bill is reduced.</span><button className="btn p sm" data-pnew="dn" onClick={newDn}>New debit note</button></div></td></tr>}
          </tbody></table></div>
      </div>
      <PurchaseView id={view} onClose={() => setView(null)} />
    </section>
  );
}
