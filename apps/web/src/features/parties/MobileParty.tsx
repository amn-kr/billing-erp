/**
 * One party on a phone (owner's request, 6 Nov 2026), drawn after the owner's approved Classic mock party-detail:
 * a dark header with the name, phone and balance, three tiles (Reminder, Statement, Edit party), the party's
 * transactions newest first with the balance after each, and a bar at the bottom: Take Payment and Add Sale
 * (for a supplier: Pay Supplier and Add Purchase). Tapping a party on the phone Home opens it (/parties?sel=<id>).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { can, money, todayIst, daysBetween, type MeResponse } from '@billing/shared';
import { useState } from 'react';
import { api } from '../../lib/api';
import { RawIcon } from '../../components/Icon';
import { useStyles } from '../../lib/useStyles';
import { useFullscreen } from '../shell/EntryFrame';
import { useShell } from '../shell/store';
import { statementOf } from '../reports/party';
import { amt, initials, longDate } from '../home/MobileHome';
import { AddPartyDialog } from './AddPartyDialog';
import type { Party } from './PartiesPage';
import css from './mobile-party.css?inline';

const I = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  chat: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 10c0 3 2 5 5 5l1-1.5-2-1-1 .5c-.8-.4-1.6-1.2-2-2l.5-1-1-2z"/>',
  doc: '<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h5"/>',
  edit: '<path d="M4 8h16v12H4zM8 8V5h8v3M12 12v4"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
};

/** GET /reports/statement/:id row (dr raises what the party owes us; run = balance after it) */
interface StRow { date: string; no: string; type: string; kind: string; info: string; dr: number; cr: number; run: number; ref?: string }
/** GET /reports/party-tx/:id row (bal = still unpaid) */
interface TxRow { type: string; no: string; date: string; total: string; bal: string }
interface Row { key: string; bill: boolean; title: string; sub: string; amount: number; run: number | null; sale?: string }

/** bills and other things that add to what is owed show red with a down arrow; payments and notes green with an up arrow (mock) */
const BILL = new Set(['Sale', 'Purchase', 'Opening balance', 'Cheque bounce']);
const titleOf = (type: string, kind: string, no: string, info: string) =>
  type.startsWith('Payment') ? [kind, info.split(' · ')[0]].filter(Boolean).join(' · ') : no && no !== '—' ? `${kind} #${no.replace(/^#/, '')}` : kind;

export function MobileParty({ id, onBack }: { id: string; onBack: () => void }) {
  useStyles([css], 'mobile-party');
  useFullscreen();
  const me = useOutletContext<MeResponse>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [editing, setEditing] = useState(false);
  const reports = can(me.permissions, 'reports.view');
  const list = useQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties') });
  const tx = useQuery({ queryKey: ['party-tx', id], queryFn: () => api<TxRow[]>(`/reports/party-tx/${id}`) });
  // the running balance comes from the Party Statement, which needs reports access; without it the rows show no balance
  const st = useQuery({ queryKey: ['reports', 'statement', id, 'all'], queryFn: () => api<{ rows: StRow[] }>(`/reports/statement/${id}`), enabled: reports, retry: false });
  const p = list.data?.find((x) => x.id === id);
  if (!list.data || !tx.data) return <section className="mp" id="vPartyM"></section>;
  if (!p) return <section className="mp" id="vPartyM"><p className="mp-none">This party is not in the list any more.</p></section>;

  const sup = p.kind === 'supplier';
  const bal = money(p.balance);
  const rows: Row[] = st.data
    ? st.data.rows.filter((r) => !r.kind.endsWith('(cancelled)')).map((r, i) => ({
      key: `s${i}`, bill: BILL.has(r.type), title: titleOf(r.type, r.kind, r.no, r.info),
      sub: [longDate(r.date), /\d+ items?/.exec(r.info)?.[0]].filter(Boolean).join(' · '), amount: r.dr || r.cr, run: r.run, sale: r.type === 'Sale' ? r.ref : undefined,
    })).reverse()
    : tx.data.map((r, i) => ({
      key: `t${i}`, bill: BILL.has(r.type), title: titleOf(r.type, r.type === 'Payment-In' ? 'Payment received' : r.type === 'Payment-Out' ? 'Payment made' : r.type, r.no, ''),
      sub: r.date ? longDate(r.date) : '', amount: Number(r.total), run: null,
    }));
  // "Due since": the oldest bill this party still owes something on
  const owed = tx.data.filter((r) => BILL.has(r.type) && r.date && money(r.bal).gt(0)).map((r) => r.date).sort()[0];
  const since = owed && !bal.isZero() ? daysBetween(owed, todayIst()) : null;
  const msg = `Dear ${p.name}, your balance with ${me.business!.name} is ₹${amt(bal.abs().toNumber())}. Please pay at the earliest. Thank you.`;
  const remind = () => {
    if (!bal.gt(0)) { showToast(sup ? 'Nothing to ask for: you owe this supplier' : 'Nothing is due from this party'); return; }
    if (p.phone) { window.open(`https://wa.me/91${p.phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener'); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(msg).then(() => showToast('No phone number saved: reminder message copied'), () => showToast('Copy blocked by the browser'));
    else showToast('Copy blocked by the browser');
  };
  const n = Date.now();

  return (
    <section className="mp" id="vPartyM">
      <header className="mp-head">
        <div className="mp-top">
          <button type="button" className="mp-ib" id="mpBack" aria-label="Back" onClick={onBack}><RawIcon d={I.back} /></button>
          <span className="mp-av" aria-hidden="true">{initials(p.name)}</span>
          <div className="mp-tt"><b>{p.name}</b><small>{[p.phone ? `+91 ${p.phone.slice(0, 5)} ${p.phone.slice(5)}` : '', sup ? 'Supplier' : 'Customer'].filter(Boolean).join(' · ')}</small></div>
          {p.phone ? <a className="mp-ib g" href={`tel:+91${p.phone}`} aria-label="Call party"><RawIcon d={I.call} /></a> : null}
        </div>
        <div className="mp-bal">
          <div><span>Balance{bal.isZero() ? '' : bal.gt(0) ? ' · You’ll Get' : ' · You’ll Give'}</span><b className={bal.gt(0) ? 'get' : bal.lt(0) ? 'give' : ''}>₹{amt(bal.abs().toNumber())}</b></div>
          {since !== null ? <small>{since > 0 ? `Due since ${since} day${since === 1 ? '' : 's'}` : 'Due today'}</small> : bal.isZero() ? <small>Settled</small> : null}
        </div>
      </header>

      <div className="mp-tiles">
        <button type="button" className="tg" id="mpRemind" onClick={remind}><RawIcon d={I.chat} />Reminder</button>
        <button type="button" className="tb" id="mpStmt" onClick={() => { if (!reports) { showToast('Statements need access to reports'); return; } statementOf(p.id); nav('/reports?r=pstmt'); }}><RawIcon d={I.doc} />Statement</button>
        <button type="button" className="to" id="mpEdit" onClick={() => setEditing(true)}><RawIcon d={I.edit} />Edit party</button>
      </div>

      <h2 className="mp-h">Transactions</h2>
      <ul className="mp-list" aria-label="Transactions">
        {rows.map((r) => {
          const body = (
            <>
              <span className={`mp-ic ${r.bill ? 'bill' : 'pay'}`} aria-hidden="true"><RawIcon d={r.bill ? I.down : I.up} /></span>
              <span className="mp-mid"><b>{r.title}</b><small>{r.sub}</small></span>
              <span className={`mp-amt ${r.bill ? 'bill' : 'pay'}`}><b>₹{amt(r.amount)}</b>{r.run !== null ? <small>Bal ₹{amt(Math.abs(r.run))}</small> : null}</span>
            </>
          );
          return <li key={r.key}>{r.sale ? <button type="button" onClick={() => nav('/sales', { state: { preview: r.sale } })}>{body}</button> : <div>{body}</div>}</li>;
        })}
        {!rows.length && <li className="mp-none">No transactions yet. Tap {sup ? 'Add Purchase' : 'Add Sale'} to make the first one.</li>}
      </ul>

      <div className="mp-bar">
        {sup ? (
          <>
            <button type="button" className="pay" id="mpPay" onClick={() => nav(`/payments-made?new=1&party=${p.id}`)}>Pay Supplier</button>
            <button type="button" className="sale" id="mpAdd" onClick={() => nav(`/purchases/new?kind=bill&party=${p.id}&n=${n}`)}>Add Purchase</button>
          </>
        ) : (
          <>
            <button type="button" className="pay" id="mpPay" onClick={() => nav(`/payments-received?party=${p.id}`)}>Take Payment</button>
            <button type="button" className="sale" id="mpAdd" onClick={() => nav(`/sales/new?party=${p.id}&n=${n}`)}>Add Sale</button>
          </>
        )}
      </div>

      <AddPartyDialog open={editing} edit={editing ? p : null} onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); void qc.invalidateQueries({ queryKey: ['parties'] }); showToast('Party saved'); }} />
    </section>
  );
}
