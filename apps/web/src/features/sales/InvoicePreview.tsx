/**
 * Invoice preview (#ipv): the prototype's window (title bar, Payment link, WhatsApp,
 * Print, New invoice). The paper inside is the one shared renderer (features/print/Paper)
 * with the shop's Settings › Print & invoice choices, so it is exactly what Print and
 * "Save as PDF" give. Shows invoices, quotations, delivery challans and the challan view
 * of an invoice (slChallan).
 */
import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { STATES, money } from '@billing/shared';
import { api } from '../../lib/api';
import { dmy, inr2f } from '../../lib/format';
import { Copies, PaperFit, Paper, docNo, docTitle, fromSale, pageSize } from '../print/Paper';
import { usePrintOpts } from '../print/opts';
import { fileTitle, printNow, usePrintSource } from '../print/printer';
import { useEscape } from '../../lib/useEscape';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useSettings } from '../../lib/settings';
import { Icon, RawIcon } from '../../components/Icon';
import type { SaleDoc } from './model';

export interface Biz { name: string; shortName: string; phone: string; address: string; city: string; pin: string; stateCode: string; gstin: string; email?: string }
export const useBiz = () => useQuery({ queryKey: ['business-current'], queryFn: () => api<Biz>('/businesses/current') });
export const bzName = (b?: Biz) => b?.name || 'My Business';
export const bzLine = (b?: Biz, sep = ' · ') => [[b?.address, [b?.city, b?.pin].filter(Boolean).join(' ')].filter(Boolean).join(', '), b?.phone].filter(Boolean).join(sep);
export const stName = (c: string) => STATES.find((s) => s[0] === c)?.[1] ?? '';
export const pct = (n: string | number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '%';
const WA = '<path d="M4 5h16v11H9l-5 4z"/>';
const PRINT = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';
const X = '<path d="M6 6l12 12M18 6L6 18"/>';

export function InvoicePreview({ doc, challan, hsnOf, onClose, onNew, onLink }: { doc: SaleDoc | null; challan?: boolean; hsnOf?: (itemId: string | null) => string; onClose: () => void; onNew: () => void; onLink: (d: SaleDoc) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const biz = useBiz().data;
  const sdata = (useSettings().data?.data ?? {}) as { upi?: string; upiName?: string };
  const o = usePrintOpts();
  const open = !!doc;
  const partyId = doc?.party?.id;
  const party = useQuery({ queryKey: ['party', partyId], queryFn: () => api<{ balance: string }>(`/parties/${partyId}`), enabled: !!partyId && o.partyBal && doc?.kind === 'invoice' });
  const pd = doc ? fromSale(doc, { challan: challan || doc.kind === 'challan', upi: sdata.upi ?? '', partyBalance: party.data?.balance ?? null, hsnOf }) : null;
  usePrintSource(open, { el: () => document.getElementById('ipvCopies'), title: pd ? fileTitle(docTitle(pd, o), docNo(pd)) : document.title, page: pageSize(o) });
  useOpenFocus(open, ref);
  useEscape(open, onClose);
  if (!doc || !pd) return <div className="ov c" id="ipv" hidden ref={ref}><div className="mdl ipvm" role="dialog" aria-modal="true" aria-labelledby="ipvTitle"></div></div>;
  const v = doc;
  const dc = pd.kind === 'challan';
  const q = v.kind === 'quotation';
  const due = money(pd.balance);
  const bal = money(v.total).minus(pd.received);
  const phone = v.party?.phone || v.cashPhone;
  const msg = `Hello ${v.partyName}, here is your invoice ${v.number} dated ${dmy(v.date)} from ${bzName(biz)}. Total ₹${inr2f(v.total)}${bal.gt(0) ? `, balance due ₹${inr2f(bal.toFixed(2))}${v.mode === 'credit' ? ' by ' + dmy(v.dueDate) : ''}` : ', fully paid'}. Thank you!`;
  const qmsg = `Hello ${v.partyName}, here is our quotation ${v.number} dated ${dmy(v.date)} for ₹${inr2f(v.total)}${v.dueDate ? `, valid till ${dmy(v.dueDate)}` : ''}. — ${bzName(biz)}`;
  const title = dc ? `Delivery challan · ${v.number}` : q ? `Quotation ${v.number} · ${v.partyName}` : `${v.number} · ${v.partyName}`;
  const paper = <Paper d={pd} o={o} biz={biz} states={STATES} />;
  return (
    <div className="ov c" id="ipv" ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'ipv') onClose(); }}>
      <div className="mdl ipvm" role="dialog" aria-modal="true" aria-labelledby="ipvTitle">
        <div className="ipvbar"><h3 id="ipvTitle" style={{ margin: 0, fontSize: 16, flex: 1 }}>{title}</h3>
          <button className="btn sm" type="button" id="ipvLink" hidden={q || dc || v.cancelled || !due.gt(0)} style={dc ? { display: 'none' } : undefined} onClick={() => onLink(v)}><Icon name="phone" />Payment link</button>
          <a className="btn sm" id="ipvWa" href={phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(q ? qmsg : msg)}` : '#'} hidden={!phone} target="_blank" rel="noopener" style={{ textDecoration: 'none', ...(dc && { display: 'none' }) }}><RawIcon d={WA} />Share on WhatsApp</a>
          <button className="btn sm" type="button" id="ipvPrint" onClick={printNow}><RawIcon d={PRINT} />Print</button>
          <button className="btn p sm" type="button" id="ipvNew" style={dc ? { display: 'none' } : undefined} onClick={onNew}><Icon name="plus" />{q && v.status !== 'converted' ? 'Convert to invoice' : 'New invoice'}</button>
          <button className="ib" type="button" id="ipvClose" aria-label="Close" onClick={onClose}><RawIcon d={X} /></button></div>
        <div className={`ivsheet${o.theme === 'simple' ? '' : ' ppx'}`} id="ipvSheet">{o.theme === 'simple' ? paper : <PaperFit o={o}>{paper}</PaperFit>}</div>
        <Copies id="ipvCopies" d={pd} o={o} biz={biz} states={STATES} />
      </div>
    </div>
  );
}
