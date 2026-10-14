/**
 * THE invoice renderer. Every printed sales document (invoice, quotation, delivery
 * challan, credit note) is drawn here, driven only by the saved print choices
 * (Settings › Print & invoice): the Settings preview, the preview windows, Print and
 * "Save as PDF" all show this same paper. Do not draw invoices anywhere else.
 *
 * Layouts: "classic" (boxed, the owner's sample bill, default) and "simple" (the
 * prototype's invoice preview #ipv, kept class for class so it still matches it).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { money } from '@billing/shared';
import { dmy, inr2f } from '../../lib/format';
import { qfmt } from '../items/ItemsPage';
import type { SaleDoc } from '../sales/model';
import { COLDEF, MARGIN_PX, NAME_PX, PAPER, TEXT_PX, type Bot, type ColKey, type PrintOpts, type Top } from './opts';

export interface Biz { name: string; phone: string; address: string; city: string; pin: string; stateCode: string; gstin: string; email?: string }
export interface PLine { name: string; code: string; hsn: string; brand: string; series: string; cat: string; grp: string; qty: string; unit: string; mrp: string | null; list: string | null; whole: string | null; price: string; discPct: string; gst: string; taxable: string; tax: string; amount: string }
/** one document, ready to print */
export interface PDoc {
  kind: 'invoice' | 'quotation' | 'challan' | 'credit_note';
  number: string; date: string; dueDate: string | null; mode: 'credit' | 'cash'; taxMode: 'gst' | 'bos' | 'none'; placeOfSupply: string; cancelled: boolean;
  party: { name: string; city: string; phone: string; gstin: string };
  /** printed references (Challan no., PO, transport, …) */
  refs: [string, string][]; description: string; notes: string;
  lines: PLine[];
  billDiscount: string; taxable: string; cgst: string; sgst: string; igst: string; tcs: string; transport: string; labour: string; bankCharge: string; roundAmount: string; total: string; words: string;
  received: string; payMode: string; balance: string; partyBalance: string | null; upi: string;
  /** delivery challan heading lines (number · date, "Billed in …" / "Against invoice …") and its transport line */
  dc?: { no: string; sub: string[]; transport: string };
}

const STATES_NAME: Record<string, string> = {};
export const stateName = (c: string, list: readonly (readonly [string, string])[]) => (STATES_NAME[c] ??= list.find((s) => s[0] === c)?.[1] ?? '');

/** a SaleDoc from the API → PDoc. `challan`: the delivery challan view of an invoice. */
export function fromSale(v: SaleDoc, o: { challan?: boolean; upi?: string; partyBalance?: string | null; hsnOf?: (itemId: string | null) => string } = {}): PDoc {
  const x = v.extra as Record<string, unknown>;
  const s = (k: string) => (typeof x[k] === 'string' ? (x[k] as string) : '');
  const qs = (x.quoteRefs as { no: string; date: string }[] | undefined) ?? [];
  const g = v.taxMode === 'gst';
  // like the prototype, the invoice shows the money taken with it (later payments are on the receipts)
  const atSale = v.payment ? money(v.payment.amount) : money(0);
  const recv = atSale.gt(v.total) ? money(v.total) : atSale;
  const bal = money(v.total).minus(recv);
  const refs = ([
    ['Billing name', v.billName], ['Challan no.', s('challanNo')], ['PO / estimate', s('poNo') ? s('poNo') + (s('poDate') ? ' · ' + dmy(s('poDate')) : '') : ''],
    ['Quotation', qs.map((q) => q.no + (q.date ? ' (' + dmy(q.date) + ')' : '')).join(', ')], ['E-way bill', g ? s('ewb') : ''], ['Transport', s('transport')],
    ['Vehicle / bilty', s('vehicle')], ['Delivery date', s('deliveryDate') ? dmy(s('deliveryDate')) : ''],
  ] as [string, string][]).filter((r) => !!r[1]);
  const isDc = o.challan || v.kind === 'challan';
  return {
    kind: isDc ? 'challan' : v.kind, number: v.number, date: v.date, dueDate: v.dueDate, mode: v.mode, taxMode: v.taxMode, placeOfSupply: v.placeOfSupply, cancelled: v.cancelled,
    party: { name: v.partyName, city: v.party?.city ?? '', phone: v.party?.phone || v.cashPhone, gstin: v.party?.gstin ?? '' },
    refs, description: s('description'), notes: v.notes,
    lines: v.lines.map((l) => {
      const e = l as typeof l & { mrp?: string | null; listPrice?: string | null; wholesalePrice?: string | null };
      return { name: l.group && l.brand ? l.group : l.name, code: l.code, hsn: (o.hsnOf ? o.hsnOf(l.itemId) : l.hsn) || l.hsn, brand: l.brand, series: l.series, cat: l.category, grp: l.group, qty: l.qty, unit: l.unit, mrp: e.mrp ?? null, list: e.listPrice ?? null, whole: e.wholesalePrice ?? null, price: l.price, discPct: l.discPct, gst: l.gstRate, taxable: l.taxable, tax: l.tax, amount: l.amount };
    }),
    billDiscount: v.billDiscount, taxable: v.taxable, cgst: v.cgst, sgst: v.sgst, igst: v.igst, tcs: v.tcs, transport: v.transport, labour: v.labour, bankCharge: v.bankCharge, roundAmount: v.roundAmount, total: v.total, words: v.words,
    received: recv.toFixed(2), payMode: recv.gt(0) ? v.payment?.mode ?? '' : '', balance: (bal.isNegative() ? money(0) : bal).toFixed(2), partyBalance: o.partyBalance ?? null, upi: o.upi ?? '',
    dc: isDc ? (o.challan
      ? { no: `DC-${v.number.replace(/^\D+/, '')}`, sub: [`DC-${v.number.replace(/^\D+/, '')} · ${dmy(v.date)}`, `Against invoice ${v.number}`], transport: '' }
      : { no: v.number, sub: [`${v.number} · ${dmy(v.date)}`, ...(s('invoiceNo') ? [`Billed in ${s('invoiceNo')}`] : [])], transport: s('transport') || s('vehicle') ? `Transport: ${[s('transport'), s('vehicle')].filter(Boolean).join(' · ')}` : '' }) : undefined,
  };
}

/** The printed name of a document (Change transaction names). */
export function docTitle(d: PDoc, o: PrintOpts): string {
  const n = (k: string, def: string) => (o.names[k] ?? '').trim() || def;
  if (d.kind === 'quotation') return n('estimate', 'Quotation');
  if (d.kind === 'challan') return n('challan', 'Delivery Challan');
  if (d.kind === 'credit_note') return n('credit', 'Credit Note');
  if (d.taxMode === 'bos' || (d.taxMode === 'none' && o.bos)) return 'Bill of Supply';
  return n('sale', d.taxMode === 'gst' ? 'Tax Invoice' : 'Bill');
}
/** the number shown on the document (a challan made from an invoice has its own DC number) */
export const docNo = (d: PDoc) => d.dc?.no ?? d.number;

const COPY = { orig: 'Original for recipient', dup: 'Duplicate for transporter', trip: 'Triplicate for supplier' } as const;
export const copiesOf = (o: PrintOpts) => (Object.keys(COPY) as (keyof typeof COPY)[]).filter((k) => o.copies[k]).map((k) => COPY[k]);
const upiOk = (v: string) => /^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$/.test((v || '').trim());
const pct = (n: string | number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '%';
const r2 = (n: number) => Math.round(n * 100) / 100;
/** print order of the columns (the dialog groups them differently) */
const ORDER: ColKey[] = ['sl', 'name', 'code', 'brand', 'series', 'cat', 'grp', 'hsn', 'qty', 'unit', 'mrp', 'list', 'whole', 'price', 'discAmt', 'discPct', 'txPrice', 'taxable', 'taxPct', 'taxAmt', 'rate', 'amount'];

export interface Col { key: ColKey; label: string; n: boolean; v: (l: PLine, i: number) => string }
export function columns(d: PDoc, o: PrintOpts, m: (v: string | number) => string): Col[] {
  const g = d.taxMode === 'gst';
  const anyDisc = d.lines.some((l) => Number(l.discPct));
  const unitOn = o.cols.unit.on;
  const def = new Map(COLDEF.map(([, k, , , x]) => [k, x ?? {}]));
  const val = (k: ColKey) => (l: PLine, i: number): string => {
    const q = Number(l.qty) || 1;
    switch (k) {
      case 'sl': return String(i + 1); case 'name': return l.name; case 'code': return l.code; case 'hsn': return l.hsn; case 'brand': return l.brand; case 'series': return l.series; case 'cat': return l.cat; case 'grp': return l.grp;
      case 'mrp': return Number(l.mrp) ? m(l.mrp!) : ''; case 'list': return Number(l.list) ? m(l.list!) : ''; case 'whole': return Number(l.whole) ? m(l.whole!) : '';
      // no Unit column: the unit goes with the quantity, as on the prototype's invoice ("66 PCS")
      case 'qty': return unitOn ? qfmt(l.qty) : `${qfmt(l.qty)} ${l.unit}`; case 'unit': return l.unit; case 'price': return m(l.price);
      case 'discAmt': return Number(l.discPct) ? m(r2((Number(l.qty) * Number(l.price) * Number(l.discPct)) / 100)) : ''; case 'discPct': return Number(l.discPct) ? r2(Number(l.discPct)) + '%' : '';
      case 'txPrice': return m(r2(Number(l.taxable) / q)); case 'taxable': return m(l.taxable); case 'taxPct': return pct(l.gst); case 'taxAmt': return m(l.tax);
      case 'rate': return m(r2(Number(l.amount) / q)); case 'amount': return m(l.amount);
    }
  };
  return ORDER.filter((k) => {
    const x = def.get(k)!;
    if (!o.cols[k].on) return false;
    if (x.gst && !g) return false;
    if (x.disc && !anyDisc) return false;
    // a delivery challan carries no prices
    if (d.kind === 'challan' && x.money) return false;
    return true;
  }).map((k) => ({ key: k, label: o.cols[k].label, n: !!def.get(k)!.n, v: val(k) }));
}

const fmt = (o: PrintOpts) => (v: string | number) => (o.grouping ? inr2f(String(v)) : Number(v).toFixed(2));

/** One page of the chosen layout. `copy`: the label for this copy (Original for recipient, …). */
export function Paper({ d, o, biz, states, copy }: { d: PDoc; o: PrintOpts; biz?: Biz; states: readonly (readonly [string, string])[]; copy?: string }) {
  const [pw, ph] = o.landscape ? [PAPER[o.paper][1], PAPER[o.paper][0]] : PAPER[o.paper];
  const phmm = `${(o.landscape ? PAPER_MM[o.paper][0] : PAPER_MM[o.paper][1]) - 1}mm`;
  const c = copy ?? copiesOf(o)[0] ?? '';
  if (o.theme === 'simple') {
    // the prototype's sizes; it flows with its content and takes the width of its window
    const style = { '--ivc': o.color, '--ivfs': `${SIMPLE_TEXT[o.textSize]}px`, '--ivcn': `${SIMPLE_NAME[o.nameSize]}px`, '--pm': `${MARGIN_PX[o.margin]}px`, '--phmm': phmm } as CSSProperties;
    return <Simple d={d} o={o} biz={biz} states={states} copy={c} style={style} />;
  }
  const style = { '--ivc': o.color, '--ivfs': `${TEXT_PX[o.textSize]}px`, '--ivcn': `${NAME_PX[o.nameSize]}px`, '--phmm': phmm, width: pw, minHeight: ph, padding: MARGIN_PX[o.margin] } as CSSProperties;
  return <Classic d={d} o={o} biz={biz} states={states} copy={c} style={style} />;
}
const SIMPLE_TEXT = { s: 11.5, m: 12.5, l: 13.5 } as const;
const SIMPLE_NAME = { s: 14, m: 16, l: 20, xl: 24 } as const;
const PAPER_MM = { A4: [210, 297], A5: [148, 210] } as const;
/** the browser's @page size for this paper */
export const pageSize = (o: PrintOpts) => `${o.paper} ${o.landscape ? 'landscape' : 'portrait'}`;

/** Every chosen copy, one page each: what Print and "Save as PDF" print. Hidden on screen. */
export function Copies({ d, o, biz, states, id }: { d: PDoc; o: PrintOpts; biz?: Biz; states: readonly (readonly [string, string])[]; id: string }) {
  const list = d.kind === 'invoice' ? copiesOf(o) : [''];
  return <div id={id} className="prcopies" hidden>{(list.length ? list : ['']).map((c, i) => <Paper key={i} d={d} o={o} biz={biz} states={states} copy={c} />)}</div>;
}

/** A paper scaled down to fit its box (Settings preview; landscape in the preview window). */
export function PaperFit({ children, o, max = 1 }: { children: ReactNode; o: PrintOpts; max?: number }) {
  const fr = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = fr.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [pw] = o.landscape ? [PAPER[o.paper][1]] : [PAPER[o.paper][0]];
  const k = Math.min(max, w ? w / pw : 1);
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={fr} className="ppfit" style={{ height: h * k || undefined }}>
      <div ref={inner} className="ppad" style={{ width: pw, transform: k < 1 ? `scale(${k})` : undefined, transformOrigin: '0 0', margin: k >= 1 ? '0 auto' : undefined }}>{children}</div>
    </div>
  );
}

function Classic({ d, o, biz, states, copy, style }: { d: PDoc; o: PrintOpts; biz?: Biz; states: readonly (readonly [string, string])[]; copy: string; style: CSSProperties }) {
  const m = fmt(o);
  const cols = columns(d, o, m);
  const g = d.taxMode === 'gst';
  const q = d.kind === 'quotation';
  const dc = d.kind === 'challan';
  const inter = Number(d.igst) > 0;
  const show = (b: string) => !o.hide.includes(b);
  const fill = o.area === 'min' ? Math.max(0, (parseInt(o.minRows) || 0) - d.lines.length) : 0;
  const addr = [biz?.address, [biz?.city, biz?.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const name = biz?.name || 'My Business';
  const title = docTitle(d, o);
  const qty = d.lines.reduce((a, l) => a.plus(money(l.qty)), money(0));
  const amt = d.lines.reduce((a, l) => a.plus(money(l.amount)), money(0));
  const saved = d.lines.reduce((a, l) => (Number(l.mrp) ? a.plus(money(l.mrp!).times(l.qty)).minus(l.amount) : a), money(0));
  const rates: Record<string, { tv: number; tx: number }> = {};
  if (g) for (const l of d.lines) { const r = (rates[Number(l.gst)] ??= { tv: 0, tx: 0 }); r.tv += Number(l.taxable); r.tx += Number(l.tax); }
  const meta: [string, string][] = [
    [dc ? 'Challan No.' : q ? 'Quotation No.' : d.kind === 'credit_note' ? 'Credit Note No.' : 'Invoice No.', docNo(d)], ['Date', dmy(d.date)],
    ...d.refs.filter(([k]) => k !== 'Billing name').map(([k, v]): [string, string] => [k === 'Challan no.' ? 'Challan No.' : k, v]),
    ...((q ? [['Valid till', dmy(d.dueDate)]] : d.kind === 'invoice' && d.mode === 'credit' && d.dueDate ? [['Due date', dmy(d.dueDate)]] : []) as [string, string][]),
    ...((g ? [['Place of supply', `${stateName(d.placeOfSupply, states)} (${d.placeOfSupply})`]] : []) as [string, string][]),
  ];
  if (meta.length % 2) meta.push(['', '']);
  const billing = d.refs.find(([k]) => k === 'Billing name')?.[1];
  const top: Record<Top, ReactNode> = {
    title: <div className="ivxt" key="title"><b>{title}</b>{copy ? <small>{copy}</small> : null}</div>,
    biz: (
      <div className="ivxbx ivxh" key="biz"><div className="ivxco">{o.showName ? <b>{name}</b> : null}{o.showAddr && addr ? <small>{addr}</small> : null}{o.showPhone && biz?.phone ? <small>Phone no.: {biz.phone}</small> : null}{o.showEmail && biz?.email ? <small>Email: {biz.email}</small> : null}{o.firm ? <small>Firm Name : {o.firm}</small> : null}{g && biz?.gstin ? <small>GSTIN : {biz.gstin}</small> : null}</div>
        <div className="ivxmeta">{meta.map(([k, v], i) => <div key={i}>{k ? <><span>{k}</span><b>{v}</b></> : null}</div>)}</div></div>
    ),
    bill: <div className="ivxbx ivxbill" key="bill"><span>{dc ? 'Deliver To' : 'Bill To'}</span><b>{d.party.name}</b>{billing ? <small>{billing}</small> : null}{d.party.city || d.party.phone ? <small>{[d.party.city, d.party.phone ? '+91 ' + d.party.phone : ''].filter(Boolean).join(' · ')}</small> : null}{g && d.party.gstin ? <small>GSTIN : {d.party.gstin}</small> : null}{o.description && d.description ? <small className="ivxdesc">{d.description}</small> : null}{d.dc?.transport ? <small>{d.dc.transport}</small> : null}</div>,
  };
  const foot: Record<Bot, ReactNode> = {
    bank: <div key="bank"><b>Bank Details</b>{upiOk(d.upi) && !q && !dc ? <small>UPI: {d.upi}</small> : null}</div>,
    terms: <div key="terms"><b>Terms and conditions</b>{o.terms ? <small className="ivxpre">{o.terms}</small> : null}</div>,
    sign: <div key="sign" className="ivxsig"><small>For : {name}</small><span className="ivxsimg"></span><b>{o.sign || 'Authorized Signatory'}</b></div>,
  };
  const bot = o.bot.filter((b) => show(b) && !(dc && b === 'bank'));
  const tops = o.top.filter(show);
  const rows = (
    <>
      {d.lines.map((l, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={c.n ? 'n' : undefined}>{c.key === 'name' ? <b>{c.v(l, i)}</b> : c.v(l, i)}</td>)}</tr>)}
      {Array.from({ length: fill }, (_, i) => <tr className="ivempty" key={'e' + i}>{cols.map((c) => <td key={c.key}>&nbsp;</td>)}</tr>)}
      {o.area === 'fill' ? <tr className="ivfill">{cols.map((c) => <td key={c.key}></td>)}</tr> : null}
    </>
  );
  return (
    <div className={`ivx ppage${o.area === 'fill' ? ' full' : ''}`} style={style}>
      {d.cancelled ? <div className="ivcan">CANCELLED</div> : null}
      {tops[0] === 'title' ? top.title : null}
      <div className="ivxbox">
        {tops.filter((b, i) => !(b === 'title' && i === 0)).map((b) => top[b])}
        <div className="ivxtw"><table className="ivxtab"><thead><tr>{cols.map((c) => <th key={c.key} className={c.n ? 'n' : undefined}>{c.label}</th>)}</tr></thead>
          {/* the Total row is the body's last row, so it prints once at the end (not on every page) and the empty rows stretch above it */}
          <tbody>{rows}
          {o.totalQty ? <tr className="ivxtot">{cols.map((c) => <td key={c.key} className={c.n ? 'n' : undefined}>{c.key === 'name' ? <b>Total</b> : c.key === 'qty' ? <b>{qfmt(qty.toFixed(3))}</b> : c.key === 'amount' ? <b>{m(amt.toFixed(2))}</b> : ''}</td>)}</tr> : null}</tbody>
        </table></div>
        {!dc && (show('words') || show('amts')) ? (
          <div className="ivxbx ivxsum"><div>{show('words') && o.words ? <><span>{q ? 'Quotation' : 'Invoice'} Amount in Words</span><b>{d.words}</b></> : null}
            {g && o.taxTable ? <table className="ivxtax"><thead><tr><th>GST rate</th><th className="n">Taxable</th>{inter ? <th className="n">IGST</th> : <><th className="n">CGST</th><th className="n">SGST</th></>}</tr></thead><tbody>{Object.entries(rates).map(([r, x]) => <tr key={r}><td>{pct(r)}</td><td className="n">{m(r2(x.tv))}</td>{inter ? <td className="n">{m(r2(x.tx))}</td> : <><td className="n">{m(r2(x.tx / 2))}</td><td className="n">{m(r2(x.tx / 2))}</td></>}</tr>)}</tbody></table> : null}
            {d.taxMode === 'bos' ? <small className="ivxpre">Composition taxable person, not eligible to collect tax on supplies.</small> : null}
            {d.notes ? <><span style={{ marginTop: 6 }}>Notes</span><small className="ivxpre">{d.notes}</small></> : null}</div>
            {show('amts') ? <div className="ivxamt"><b>Amounts</b>
              {Number(d.billDiscount) ? <div><span>Discount</span><span>−{m(d.billDiscount)}</span></div> : null}
              <div><span>{g ? 'Taxable value' : 'Sub Total'}</span><span>{m(d.taxable)}</span></div>
              {g ? (inter ? <div><span>IGST</span><span>{m(d.igst)}</span></div> : <><div><span>CGST</span><span>{m(d.cgst)}</span></div><div><span>SGST</span><span>{m(d.sgst)}</span></div></>) : null}
              {Number(d.tcs) ? <div><span>TCS</span><span>{m(d.tcs)}</span></div> : null}{Number(d.transport) ? <div><span>Transport charge</span><span>{m(d.transport)}</span></div> : null}{Number(d.labour) ? <div><span>Labour charge</span><span>{m(d.labour)}</span></div> : null}{Number(d.bankCharge) ? <div><span>Bank comm.</span><span>{m(d.bankCharge)}</span></div> : null}
              {Number(d.roundAmount) ? <div><span>Round off</span><span>{Number(d.roundAmount) > 0 ? '+' : '−'}{m(Math.abs(Number(d.roundAmount)))}</span></div> : null}
              <div className="t"><b>Total</b><b>{m(d.total)}</b></div>
              {!q && o.received ? <div><span>Received{o.payMode && d.payMode ? ` (${d.payMode})` : ''}</span><span>{m(d.received)}</span></div> : null}
              {!q && o.balance ? <div><span>Balance</span><span>{m(d.balance)}</span></div> : null}
              {!q && o.partyBal && d.partyBalance !== null ? <div><span>Current balance</span><span>{m(d.partyBalance)}</span></div> : null}
              {o.saved && saved.gt(0) ? <div><span>You saved</span><span>{m(saved.toFixed(2))}</span></div> : null}</div> : <div></div>}
          </div>
        ) : null}
        {dc ? <div className="ivxbx ivxft" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}><div className="ivxsig"><small>Received by</small><span className="ivxsimg"></span><b>Name &amp; signature</b></div>{foot.sign}</div> : null}
        {!dc && bot.length ? <div className="ivxbx ivxft" style={{ gridTemplateColumns: `repeat(${bot.length},minmax(0,1fr))` }}>{bot.map((b) => foot[b])}</div> : null}
      </div>
    </div>
  );
}

/** "Simple": the prototype's invoice preview (showPreview / slChallan / dcPrint), class for class. */
function Simple({ d, o, biz, states, copy, style }: { d: PDoc; o: PrintOpts; biz?: Biz; states: readonly (readonly [string, string])[]; copy: string; style: CSSProperties }) {
  const m = fmt(o);
  const g = d.taxMode === 'gst';
  const q = d.kind === 'quotation';
  const inter = Number(d.igst) > 0;
  const name = biz?.name || 'My Business';
  const line = [[o.showAddr ? biz?.address : '', o.showAddr ? [biz?.city, biz?.pin].filter(Boolean).join(' ') : ''].filter(Boolean).join(', '), o.showPhone ? biz?.phone : ''].filter(Boolean).join(' · ');
  const BS = biz?.stateCode || '09';
  if (d.kind === 'challan') {
    const pq = d.lines.reduce((a, l) => a + Number(l.qty), 0);
    return (
      <div className="ivpg ppage" style={style}><div className="dch"><div className="dchh"><div><b>{name}</b><small>{line}</small>{g ? <small>GSTIN {biz?.gstin}</small> : null}</div><div className="dcht"><span>{docTitle(d, o).toUpperCase()}</span>{d.dc!.sub.map((s) => <small key={s}>{s}</small>)}</div></div>
        <div className="dchp"><span>Deliver to</span><b>{d.party.name}</b>{d.party.city ? <small>{d.party.city}</small> : null}{d.party.phone ? <small>+91 {d.party.phone}</small> : null}{d.dc!.transport ? <small>{d.dc!.transport}</small> : null}</div>
        <table className="ivtab"><thead><tr><th>#</th><th>Item</th>{g ? <th>HSN</th> : null}<th className="n">Qty</th><th>Unit</th></tr></thead><tbody>
          {d.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}</td>{g ? <td>{l.hsn}</td> : null}<td className="n">{qfmt(l.qty)}</td><td>{l.unit}</td></tr>)}
          <tr className="dchtot"><td></td><td>Total quantity</td>{g ? <td></td> : null}<td className="n">{qfmt(pq)}</td><td></td></tr></tbody></table>{d.notes ? <p className="ivdesc">{d.notes}</p> : null}
        <div className="dchs"><div><i></i>Received by (name &amp; signature)</div><div><i></i>For {name}</div></div></div></div>
    );
  }
  const cols = columns(d, o, m);
  const rates: Record<string, { tv: number; tx: number }> = {};
  if (g) for (const l of d.lines) { const r = (rates[Number(l.gst)] ??= { tv: 0, tx: 0 }); r.tv += Number(l.taxable); r.tx += Number(l.tax); }
  const rk = Object.keys(rates);
  if (rk.length === 1) rates[rk[0]!] = { tv: Number(d.taxable), tx: Number(d.cgst) + Number(d.sgst) + Number(d.igst) };
  const R = d.refs;
  const saved = d.lines.reduce((a, l) => (Number(l.mrp) ? a.plus(money(l.mrp!).times(l.qty)).minus(l.amount) : a), money(0));
  return (
    <div className="ivpg ppage" style={style}>
      {d.cancelled ? <div className="ivcan">CANCELLED</div> : null}
      <div className="ivh"><div className="ivb"><span className="logo" style={{ width: 44, height: 44, fontSize: 18 }}>{(name[0] || 'B').toUpperCase()}</span><div>{o.showName ? <b>{name}</b> : null}<small>{line}</small>{o.showEmail && biz?.email ? <small>{biz.email}</small> : null}{o.firm ? <small>{o.firm}</small> : null}{g ? <small>GSTIN {biz?.gstin} · State {stateName(BS, states)} ({BS})</small> : null}</div></div>
        <div className="ivt"><b>{docTitle(d, o).toUpperCase()}</b><small>{q ? (d.dueDate ? `Valid till ${dmy(d.dueDate)}` : '') : copy}</small></div></div>
      <div className="ivg"><div><span>Bill to</span><b>{d.party.name}</b>{d.party.city ? <small>{d.party.city}</small> : null}{d.party.phone ? <small>+91 {d.party.phone}</small> : null}{g && d.party.gstin ? <small>GSTIN {d.party.gstin}</small> : null}</div>
        <div><span>{q ? 'Quotation no.' : 'Invoice no.'}</span><b>{d.number}</b><span style={{ marginTop: 6 }}>Date</span><b>{dmy(d.date)}</b></div>
        <div>{d.mode === 'credit' || q ? <><span>{q ? 'Valid till' : 'Due date'}</span><b>{dmy(d.dueDate ?? d.date)}</b></> : <><span>Payment</span><b>Cash sale</b></>}{g ? <><span style={{ marginTop: 6 }}>Place of supply</span><b>{stateName(d.placeOfSupply, states)} ({d.placeOfSupply})</b></> : null}</div></div>
      {R.length ? <div className="ivrefs">{R.map(([k, t]) => <span key={k}><small>{k}</small>{t}</span>)}</div> : null}
      {o.description && d.description ? <p className="ivdesc">{d.description}</p> : null}
      <table className="ivtab"><thead><tr>{cols.map((c) => <th key={c.key} className={c.n && c.key !== 'unit' ? 'n' : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>{d.lines.map((l, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={c.key === 'code' ? 'ivc' : c.n && c.key !== 'unit' ? 'n' : undefined}>{c.v(l, i)}</td>)}</tr>)}</tbody></table>
      <div className="ivf"><div>
        {g && o.taxTable ? (
          <table className="ivtax"><thead><tr><th>GST rate</th><th className="n">Taxable</th>{inter ? <th className="n">IGST</th> : <><th className="n">CGST</th><th className="n">SGST</th></>}</tr></thead>
            <tbody>{Object.entries(rates).map(([r, x]) => <tr key={r}><td>{pct(r)}</td><td className="n">{m(r2(x.tv))}</td>{inter ? <td className="n">{m(r2(x.tx))}</td> : <><td className="n">{m(r2(x.tx / 2))}</td><td className="n">{m(r2(x.tx / 2))}</td></>}</tr>)}</tbody></table>
        ) : d.taxMode === 'bos' ? <p className="ivnote">Composition taxable person, not eligible to collect tax on supplies.</p> : null}
        {o.words ? <div className="ivwords"><span>Amount in words</span><b>{d.words}</b></div> : null}
        {d.notes ? <div className="ivwords"><span>Notes</span><small>{d.notes}</small></div> : null}
        {upiOk(d.upi) && !q ? <div className="ivwords"><span>Pay by UPI</span><small>{d.upi}</small></div> : null}
        {o.terms ? <div className="ivwords"><span>Terms and conditions</span><small className="ivxpre">{o.terms}</small></div> : null}</div>
        <div className="ivtot">{Number(d.billDiscount) ? <div><span>Discount</span><b>−{m(d.billDiscount)}</b></div> : null}<div><span>{g ? 'Taxable value' : 'Sub total'}</span><b>{m(d.taxable)}</b></div>
          {g ? (inter ? <div><span>IGST</span><b>{m(d.igst)}</b></div> : <><div><span>CGST</span><b>{m(d.cgst)}</b></div><div><span>SGST</span><b>{m(d.sgst)}</b></div></>) : null}
          {Number(d.tcs) ? <div><span>TCS</span><b>{m(d.tcs)}</b></div> : null}{Number(d.transport) ? <div><span>Transport charge</span><b>{m(d.transport)}</b></div> : null}{Number(d.labour) ? <div><span>Labour charge</span><b>{m(d.labour)}</b></div> : null}{Number(d.bankCharge) ? <div><span>Bank comm.</span><b>{m(d.bankCharge)}</b></div> : null}
          {Number(d.roundAmount) ? <div><span>Round off</span><b>{Number(d.roundAmount) > 0 ? '+' : '−'}{m(Math.abs(Number(d.roundAmount)))}</b></div> : null}
          <div className="ivg2"><span>Total</span><b>₹{m(d.total)}</b></div>
          {q ? null : <>{o.received ? <div><span>Received{o.payMode && d.payMode ? ` (${d.payMode})` : ''}</span><b>{m(d.received)}</b></div> : null}{o.balance ? <div className="bd"><span>Balance due</span><b>₹{m(d.balance)}</b></div> : null}{o.partyBal && d.partyBalance !== null ? <div><span>Current balance</span><b>₹{m(d.partyBalance)}</b></div> : null}</>}
          {o.saved && saved.gt(0) ? <div><span>You saved</span><b>₹{m(saved.toFixed(2))}</b></div> : null}
          <div className="sig"><i></i>For {name}<br />{o.sign || 'Authorized Signatory'}</div></div></div>
    </div>
  );
}
