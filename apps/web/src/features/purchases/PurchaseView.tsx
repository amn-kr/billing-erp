/** A purchase document's view (#pvm) — the prototype's showPDoc. */
import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { dmy, inr2f } from '../../lib/format';
import { useEscape } from '../../lib/useEscape';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useSettings } from '../../lib/settings';
import { Icon } from '../../components/Icon';
import { qfmt } from '../items/ItemsPage';
import { PE_T, statusOfBill, type PurchaseDoc } from './model';
import type { PayOpen } from './PayDialog';
import { ui } from '../../styles/uiSize';

export function PurchaseView({ id, onClose, onPay }: { id: string | null; onClose: () => void; onPay?: (o: PayOpen) => void }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['purchase', id], queryFn: () => api<PurchaseDoc>(`/purchases/${id}`), enabled: !!id });
  const gst = !!useSettings().data?.gstEnabled;
  const d = id && q.data?.id === id ? q.data : null;
  useOpenFocus(!!d, ref);
  useEscape(!!d, onClose);
  const isBill = d?.kind === 'bill' && !d.cancelled;
  // newest first, as the prototype's payments list
  const pays = d ? d.settlements.filter((s) => s.kind === 'payment').sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)) : [];
  const st = d && isBill ? statusOfBill({ total: d.total, balance: d.balance, dueDate: d.dueDate }) : null;
  return (
    <div className="ov c" id="pvm" hidden={!d} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'pvm') onClose(); }}>
      <div className="mdl wide" role="dialog" aria-modal="true" aria-labelledby="pvT" style={{ width: 'min(760px,100%)' }}>
        <div className="dh"><h3 id="pvT" style={{ margin: 0, fontSize: ui.fs(18) }}>{d ? `${PE_T[d.kind]} ${d.number}` : ''}</h3><button className="ib" type="button" id="pvClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div id="pvBody">{d ? <>
          <div className="pvh"><div><small className="mu">{d.kind === 'order' ? 'To' : 'From'}</small><b>{d.party.name}</b>{d.party.gstin ? <small className="mono mu">GSTIN {d.party.gstin}</small> : null}</div>
            <div className="pvm"><span>Date <b>{dmy(d.date)}</b></span>{d.supplierRef ? <span>Supplier bill <b className="mono">{d.supplierRef}</b></span> : null}{d.kind === 'bill' && d.dueDate ? <span>Due <b>{dmy(d.dueDate)}</b></span> : null}{d.kind === 'order' && d.dueDate ? <span>Expected <b>{dmy(d.dueDate)}</b></span> : null}
              {d.kind === 'debit_note' && d.source ? <span>Against <b className="mono">{d.source}</b></span> : null}{d.kind === 'debit_note' && d.reason ? <span>Reason <b>{d.reason}</b></span> : null}{d.cancelled ? <span><b className="neg">Cancelled</b></span> : null}</div></div>
          <div className="tw"><table className="ptt2"><thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Disc</th>{gst ? <th className="n">GST</th> : null}<th className="n">Amount</th></tr></thead><tbody>{d.lines.map((l) => (
            <tr key={l.id}><td><b style={{ fontWeight: 600 }}>{l.name}</b>{gst ? <small className="mu" style={{ display: 'block' }}>HSN {l.hsn || '—'}</small> : null}</td><td className="n">{qfmt(Number(l.qty))} {l.unit}</td><td className="n">{inr2f(l.rate)}</td><td className="n">{Number(l.discPct) ? Math.round(Number(l.discPct) * 100) / 100 + '%' : '—'}</td>{gst ? <td className="n">{Number(l.gstRate)}%</td> : null}<td className="n"><b>{inr2f(l.amount)}</b></td></tr>
          ))}</tbody></table></div>
          <div className="pvt"><span>Taxable {inr2f(d.taxable)}</span><span>GST {inr2f(d.tax)}</span><b>Total ₹{inr2f(d.total)}</b></div>
          {isBill && st ? <div className="pvpay"><b>Payments</b>{pays.length ? pays.map((x) => <span key={x.number}>{dmy(x.date)} · <span className="mono">{x.number}</span> · {x.mode} · ₹{inr2f(x.amount)}</span>) : <span className="mu">No payments yet</span>}<span>Balance <b className={Number(d.balance) > 0 ? 'neg' : 'pos'}>₹{inr2f(d.balance)}</b> · <span className={`stt ${st.c}`}>{st.t}</span></span></div> : null}
        </> : null}</div>
        <div className="pvacts" id="pvActs">{d ? <>
          {isBill && Number(d.balance) > 0 && onPay ? <button className="btn p" data-paybill={d.number} onClick={() => onPay({ party: d.party.id, bill: d.id })}>Record payment</button> : null}
          {isBill ? <button className="btn" data-dnfor={d.number} onClick={() => { onClose(); navigate(`/purchases/new?kind=debit_note&against=${d.id}`); }}>Return goods (debit note)</button> : null}
          {d.kind === 'order' && d.status === 'open' && !d.cancelled ? <button className="btn p" data-poconv={d.number} onClick={() => { onClose(); navigate(`/purchases/new?kind=bill&order=${d.id}`); }}>Convert to bill</button> : null}
        </> : null}</div>
      </div>
    </div>
  );
}
