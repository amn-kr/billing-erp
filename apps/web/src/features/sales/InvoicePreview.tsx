/**
 * Invoice preview (#ipv) — the prototype's showPreview with its later additions:
 * printed references, the CANCELLED stamp, the "Payment link" button and the
 * quotation wording. Also shows a delivery challan made from an invoice (slChallan).
 */
import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { STATES, money } from '@billing/shared';
import { api } from '../../lib/api';
import { dmy, inr2f } from '../../lib/format';
import { useEscape } from '../../lib/useEscape';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useSettings } from '../../lib/settings';
import { Icon, RawIcon } from '../../components/Icon';
import { qfmt } from '../items/ItemsPage';
import type { SaleDoc } from './model';

export interface Biz { name: string; shortName: string; phone: string; address: string; city: string; pin: string; stateCode: string; gstin: string }
export const useBiz = () => useQuery({ queryKey: ['business-current'], queryFn: () => api<Biz>('/businesses/current') });
export const bzName = (b?: Biz) => b?.name || 'My Business';
export const bzLine = (b?: Biz, sep = ' · ') => [[b?.address, [b?.city, b?.pin].filter(Boolean).join(' ')].filter(Boolean).join(', '), b?.phone].filter(Boolean).join(sep);
export const stName = (c: string) => STATES.find((s) => s[0] === c)?.[1] ?? '';
export const pct = (n: string | number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '%';
const upiOk = (v: string) => /^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$/.test((v || '').trim());
const WA = '<path d="M4 5h16v11H9l-5 4z"/>';
const PRINT = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';
const X = '<path d="M6 6l12 12M18 6L6 18"/>';

/** References printed under the party block (prototype ivRefs). */
function Refs({ v, gst }: { v: SaleDoc; gst: boolean }) {
  const x = v.extra as Record<string, string & unknown>;
  const qs = (x.quoteRefs as unknown as { no: string; date: string }[] | undefined) ?? [];
  const R: [string, string][] = ([
    ['Billing name', v.billName], ['Challan no.', x.challanNo], ['PO / estimate', x.poNo ? x.poNo + (x.poDate ? ' · ' + dmy(x.poDate) : '') : ''],
    ['Quotation', qs.map((q) => q.no + (q.date ? ' (' + dmy(q.date) + ')' : '')).join(', ')], ['E-way bill', gst ? x.ewb : ''], ['Transport', x.transport],
    ['Vehicle / bilty', x.vehicle], ['Delivery date', x.deliveryDate ? dmy(x.deliveryDate) : ''],
  ] as [string, string | undefined][]).filter((r): r is [string, string] => !!r[1]);
  return (
    <>
      {R.length ? <div className="ivrefs">{R.map(([k, t]) => <span key={k}><small>{k}</small>{t}</span>)}</div> : null}
      {x.description ? <p className="ivdesc">{x.description}</p> : null}
    </>
  );
}

export function InvoicePreview({ doc, challan, onClose, onNew, onLink }: { doc: SaleDoc | null; challan?: boolean; onClose: () => void; onNew: () => void; onLink: (d: SaleDoc) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const biz = useBiz().data;
  const sdata = (useSettings().data?.data ?? {}) as { upi?: string; upiName?: string };
  const open = !!doc;
  useOpenFocus(open, ref);
  useEscape(open, onClose);
  if (!doc) return <div className="ov c" id="ipv" hidden ref={ref}><div className="mdl ipvm" role="dialog" aria-modal="true" aria-labelledby="ipvTitle"></div></div>;
  const v = doc;
  const q = v.kind === 'quotation';
  const g = v.taxMode === 'gst';
  const inter = Number(v.igst) > 0;
  // like the prototype, the invoice shows the money taken with it (later payments are on the receipts)
  const atSale = v.payment ? money(v.payment.amount) : money(0);
  const recv = atSale.gt(v.total) ? money(v.total) : atSale;
  const bal = money(v.total).minus(recv);
  const due = bal.isNegative() ? money(0) : bal;
  const BS = biz?.stateCode || '09';
  const rates: Record<string, { tv: number; tx: number }> = {};
  if (g) for (const l of v.lines) { const r = (rates[Number(l.gstRate)] ??= { tv: 0, tx: 0 }); r.tv += Number(l.taxable); r.tx += Number(l.tax); }
  const rk = Object.keys(rates);
  if (rk.length === 1) rates[rk[0]!] = { tv: Number(v.taxable), tx: Number(v.cgst) + Number(v.sgst) + Number(v.igst) };
  const anyDisc = v.lines.some((l) => Number(l.discPct));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const phone = v.party?.phone || v.cashPhone;
  const msg = `Hello ${v.partyName}, here is your invoice ${v.number} dated ${dmy(v.date)} from ${bzName(biz)}. Total ₹${inr2f(v.total)}${bal.gt(0) ? `, balance due ₹${inr2f(bal.toFixed(2))}${v.mode === 'credit' ? ' by ' + dmy(v.dueDate) : ''}` : ', fully paid'}. Thank you!`;
  const qmsg = `Hello ${v.partyName}, here is our quotation ${v.number} dated ${dmy(v.date)} for ₹${inr2f(v.total)}${v.dueDate ? `, valid till ${dmy(v.dueDate)}` : ''}. — ${bzName(biz)}`;
  const upi = sdata.upi ?? '';
  const pq = v.lines.reduce((a, l) => a + Number(l.qty), 0);
  const title = challan ? `Delivery challan · ${v.number}` : q ? `Quotation ${v.number} · ${v.partyName}` : `${v.number} · ${v.partyName}`;
  const city = v.party?.city ?? '';
  return (
    <div className="ov c" id="ipv" ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'ipv') onClose(); }}>
      <div className="mdl ipvm" role="dialog" aria-modal="true" aria-labelledby="ipvTitle">
        <div className="ipvbar"><h3 id="ipvTitle" style={{ margin: 0, fontSize: 16, flex: 1 }}>{title}</h3>
          <button className="btn sm" type="button" id="ipvLink" hidden={q || v.cancelled || !due.gt(0)} style={challan ? { display: 'none' } : undefined} onClick={() => onLink(v)}><Icon name="phone" />Payment link</button>
          <a className="btn sm" id="ipvWa" href={phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(q ? qmsg : msg)}` : '#'} hidden={!phone} target="_blank" rel="noopener" style={{ textDecoration: 'none', ...(challan && { display: 'none' }) }}><RawIcon d={WA} />Share on WhatsApp</a>
          <button className="btn sm" type="button" id="ipvPrint" onClick={() => window.print()}><RawIcon d={PRINT} />Print</button>
          <button className="btn p sm" type="button" id="ipvNew" style={challan ? { display: 'none' } : undefined} onClick={onNew}><Icon name="plus" />{q && v.status !== 'converted' ? 'Convert to invoice' : 'New invoice'}</button>
          <button className="ib" type="button" id="ipvClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <div className="ivsheet" id="ipvSheet">
          {challan ? (
            <div className="dch"><div className="dchh"><div><b>{bzName(biz)}</b><small>{bzLine(biz)}</small>{g ? <small>GSTIN {biz?.gstin}</small> : null}</div><div className="dcht"><span>DELIVERY CHALLAN</span><small>DC-{v.number.replace(/^\D+/, '')} · {dmy(v.date)}</small><small>Against invoice {v.number}</small></div></div>
              <div className="dchp"><span>Deliver to</span><b>{v.partyName}</b>{city ? <small>{city}</small> : null}{phone ? <small>+91 {phone}</small> : null}</div>
              <table className="ivtab"><thead><tr><th>#</th><th>Item</th>{g ? <th>HSN</th> : null}<th className="n">Qty</th><th>Unit</th></tr></thead><tbody>
                {v.lines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{l.name}</td>{g ? <td>{l.hsn}</td> : null}<td className="n">{qfmt(l.qty)}</td><td>{l.unit}</td></tr>)}
                <tr className="dchtot"><td></td><td>Total quantity</td>{g ? <td></td> : null}<td className="n">{qfmt(pq)}</td><td></td></tr></tbody></table>
              <div className="dchs"><div><i></i>Received by (name &amp; signature)</div><div><i></i>For {bzName(biz)}</div></div></div>
          ) : (
            <>
              {v.cancelled ? <div className="ivcan">CANCELLED</div> : null}
              <div className="ivh"><div className="ivb"><span className="logo" style={{ width: 44, height: 44, fontSize: 18 }}>{(bzName(biz)[0] || 'B').toUpperCase()}</span><div><b>{bzName(biz)}</b><small>{bzLine(biz)}</small>{g ? <small>GSTIN {biz?.gstin} · State {stName(BS)} ({BS})</small> : null}</div></div>
                <div className="ivt"><b>{q ? 'QUOTATION' : g ? 'TAX INVOICE' : v.taxMode === 'bos' ? 'BILL OF SUPPLY' : 'BILL'}</b><small>{q ? (v.dueDate ? `Valid till ${dmy(v.dueDate)}` : '') : 'Original for recipient'}</small></div></div>
              <div className="ivg"><div><span>Bill to</span><b>{v.partyName}</b>{city ? <small>{city}</small> : null}{phone ? <small>+91 {phone}</small> : null}{g && v.party?.gstin ? <small>GSTIN {v.party.gstin}</small> : null}</div>
                <div><span>{q ? 'Quotation no.' : 'Invoice no.'}</span><b>{v.number}</b><span style={{ marginTop: 6 }}>Date</span><b>{dmy(v.date)}</b></div>
                <div>{v.mode === 'credit' || q ? <><span>{q ? 'Valid till' : 'Due date'}</span><b>{dmy(v.dueDate ?? v.date)}</b></> : <><span>Payment</span><b>Cash sale</b></>}{g ? <><span style={{ marginTop: 6 }}>Place of supply</span><b>{stName(v.placeOfSupply)} ({v.placeOfSupply})</b></> : null}</div></div>
              <Refs v={v} gst={g} />
              <table className="ivtab"><thead><tr><th>#</th><th>Item</th><th>Code</th><th>Brand</th><th>Series</th>{g ? <th>HSN</th> : null}<th className="n">Qty</th><th className="n">Rate</th>{anyDisc ? <th className="n">Disc</th> : null}{g ? <th className="n">GST</th> : null}<th className="n">Amount</th></tr></thead>
                <tbody>{v.lines.map((l, i) => (
                  <tr key={l.id}><td>{i + 1}</td><td>{l.group && l.brand ? l.group : l.name}</td><td className="ivc">{l.code}</td><td>{l.brand}</td><td>{l.series}</td>{g ? <td>{l.hsn}</td> : null}<td className="n">{qfmt(l.qty)} {l.unit}</td><td className="n">{inr2f(l.price)}</td>{anyDisc ? <td className="n">{Number(l.discPct) ? r2(Number(l.discPct)) + '%' : ''}</td> : null}{g ? <td className="n">{pct(l.gstRate)}</td> : null}<td className="n">{inr2f(l.amount)}</td></tr>
                ))}</tbody></table>
              <div className="ivf"><div>
                {g ? (
                  <table className="ivtax"><thead><tr><th>GST rate</th><th className="n">Taxable</th>{inter ? <th className="n">IGST</th> : <><th className="n">CGST</th><th className="n">SGST</th></>}</tr></thead>
                    <tbody>{Object.entries(rates).map(([r, x]) => <tr key={r}><td>{pct(r)}</td><td className="n">{inr2f(r2(x.tv))}</td>{inter ? <td className="n">{inr2f(r2(x.tx))}</td> : <><td className="n">{inr2f(r2(x.tx / 2))}</td><td className="n">{inr2f(r2(x.tx / 2))}</td></>}</tr>)}</tbody></table>
                ) : v.taxMode === 'bos' ? <p className="ivnote">Composition taxable person, not eligible to collect tax on supplies.</p> : null}
                <div className="ivwords"><span>Amount in words</span><b>{v.words}</b></div>
                {v.notes ? <div className="ivwords"><span>Notes</span><small>{v.notes}</small></div> : null}
                {upiOk(upi) && !q ? <div className="ivwords"><span>Pay by UPI</span><small>{upi}</small></div> : null}</div>
                <div className="ivtot">{Number(v.billDiscount) ? <div><span>Discount</span><b>−{inr2f(v.billDiscount)}</b></div> : null}<div><span>{g ? 'Taxable value' : 'Sub total'}</span><b>{inr2f(v.taxable)}</b></div>
                  {g ? (inter ? <div><span>IGST</span><b>{inr2f(v.igst)}</b></div> : <><div><span>CGST</span><b>{inr2f(v.cgst)}</b></div><div><span>SGST</span><b>{inr2f(v.sgst)}</b></div></>) : null}
                  {Number(v.tcs) ? <div><span>TCS</span><b>{inr2f(v.tcs)}</b></div> : null}{Number(v.transport) ? <div><span>Transport charge</span><b>{inr2f(v.transport)}</b></div> : null}{Number(v.labour) ? <div><span>Labour charge</span><b>{inr2f(v.labour)}</b></div> : null}{Number(v.bankCharge) ? <div><span>Bank comm.</span><b>{inr2f(v.bankCharge)}</b></div> : null}
                  {Number(v.roundAmount) ? <div><span>Round off</span><b>{Number(v.roundAmount) > 0 ? '+' : '−'}{inr2f(Math.abs(Number(v.roundAmount)))}</b></div> : null}
                  <div className="ivg2"><span>Total</span><b>₹{inr2f(v.total)}</b></div>
                  {q ? null : <><div><span>Received{recv.gt(0) && v.payment?.mode ? ` (${v.payment.mode})` : ''}</span><b>{inr2f(recv.toFixed(2))}</b></div><div className="bd"><span>Balance due</span><b>₹{inr2f(due.toFixed(2))}</b></div></>}
                  <div className="sig"><i></i>For {bzName(biz)}<br />Authorised signatory</div></div></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
