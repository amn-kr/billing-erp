/**
 * Sales invoices (#vSales) — the prototype's renderSales with its later changes:
 * collapsible search, column-header filters (date, number, party, amounts, due
 * date, status), right-click / ⋮ actions (#slCtx) and the small window (#slm)
 * for cancel, delete, edit history and payment history. A row opens the invoice preview.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { money } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { useFitTables } from '../../lib/useFitTables';
import { Icon, RawIcon } from '../../components/Icon';
import { ThfChoices, ThfPop, type ThfAnchor } from '../../components/ThfPop';
import { atButton, RowMenu, RowMenuButton, rowMenuHandlers, type RowAction } from '../../components/RowMenu';
import { soon, useShell } from '../shell/store';
import { today as todayIst } from '../../lib/time';
import { inPeriod, statusOf, useSale, useSales, type Period, type SaleDoc, type SaleRow } from './model';
import { InvoicePreview } from './InvoicePreview';
import { SlModal, type SlModalProps } from './SlModal';
import { openHistory } from '../../components/EditHistory';
import { printNow } from '../print/printer';
import { cancelAsk, deleteAsk, withPasscode } from '../settings/passcode';
import { ui } from '../../styles/uiSize';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const FILTER = '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const PER: [Period, string][] = [['all', 'All dates'], ['oct', 'This month'], ['sep', 'Last month'], ['custom', 'Custom range…']];
const ST: [string, string][] = [['all', 'All statuses'], ['open', 'Unpaid'], ['over', 'Overdue'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
const DUE: [string, string][] = [['all', 'All due dates'], ['week', 'Due in next 7 days'], ['past', 'Past due date'], ['none', 'No due date']];
const SLX = { no: { t: 'text', lab: 'Invoice no.' }, party: { t: 'text', lab: 'Party' }, total: { t: 'num', lab: 'Total' }, recv: { t: 'num', lab: 'Received' }, bal: { t: 'num', lab: 'Balance' } } as const;
type XKey = keyof typeof SLX;
type NumF = { op: 'eq' | 'gt' | 'lt' | 'bt'; a: number; b: number | null } | null;
const OPS: ['eq' | 'gt' | 'lt' | 'bt', string][] = [['eq', 'Equal to'], ['gt', 'Greater than'], ['lt', 'Less than'], ['bt', 'Between']];
const ACTIONS: RowAction[] = [['view', 'View / Edit'], ['einv', 'Generate e-Invoice'], ['recv', 'Receive payment'], ['plink', 'Send payment link'], ['ret', 'Convert to return'], ['dch', 'Preview delivery challan'], ['payh', 'Payment history'], '-', ['cancel', 'Cancel invoice'], ['del', 'Delete', 'dz'], ['dup', 'Duplicate'], '-', ['pdf', 'Open PDF'], ['prev', 'Preview'], ['print', 'Print'], ['hist', 'View history']];
const numOk = (v: number, f: NumF) => !f || (f.op === 'eq' ? Math.abs(v - f.a) < 0.005 : f.op === 'gt' ? v > f.a : f.op === 'lt' ? v < f.a : v >= Math.min(f.a, f.b ?? f.a) && v <= Math.max(f.a, f.b ?? f.a));
const daysTo = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);
const fmShort = (x?: string) => (x ? new Date(x + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '…');

type Pop = { kind: 'per' | 'st' | 'due'; anchor: ThfAnchor } | { kind: 'range'; anchor: ThfAnchor } | { kind: 'x'; key: XKey; anchor: ThfAnchor };

export function SalesPage() {
  useFitTables();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const list = useSales('invoice');
  const [q, setQ] = useState('');
  const [tsOpen, setTsOpen] = useState(false);
  const [per, setPer] = useState<Period>('all');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [st, setSt] = useState('all');
  const [due, setDue] = useState('all');
  const [fx, setFx] = useState<{ no: string; party: string; total: NumF; recv: NumF; bal: NumF }>({ no: '', party: '', total: null, recv: null, bal: null });
  const [pop, setPop] = useState<Pop | null>(null);
  const [menu, setMenu] = useState<{ row: SaleRow; x: number; y: number; tr: HTMLElement | null } | null>(null);
  const [modal, setModal] = useState<SlModalProps | null>(null);
  const [preview, setPreview] = useState<{ id: string; challan?: boolean } | null>(null);
  const shown = useSale(preview?.id ?? null);
  const qRef = useRef<HTMLInputElement>(null);
  // just saved in the editor: show the invoice (and print it for "Save & print"), as the prototype does
  const location = useLocation();
  useEffect(() => {
    const st = location.state as { preview?: string; print?: boolean } | null;
    if (!st?.preview) return;
    setPreview({ id: st.preview });
    navigate('.', { replace: true, state: null });
    if (st.print) setTimeout(() => printNow(), 500);
  }, [location.state, navigate]);
  const closePop = useCallback((refocus: boolean) => setPop((p) => { if (refocus) (p?.anchor.el as HTMLElement | undefined)?.focus(); return null; }), []);

  if (!list.data) return <section id="vSales"></section>;
  const today = todayIst();
  const A = list.data.filter((s) => inPeriod(s.date, per, range));
  const live = A.filter((s) => !s.cancelled);
  const tot = live.reduce((a, s) => a.plus(s.total), money(0));
  const owed = live.reduce((a, s) => a.plus(s.balance), money(0));
  const s0 = q.toLowerCase();
  const L = A.filter((s) => {
    const stt = statusOf(s);
    const c = s.cancelled;
    const bal = Number(s.balance);
    if (st !== 'all') { if (st === 'cancelled') { if (!c) return false; } else if (c || !(st === 'paid' ? bal <= 0 : st === 'over' ? stt.t.startsWith('Overdue') : bal > 0)) return false; }
    if (due !== 'all') {
      const has = !c && bal > 0 && !!s.dueDate;
      const od = has ? -daysTo(s.dueDate!, today) : 0;
      if (due === 'none' ? has : !has || (due === 'past' ? od <= 0 : od > 0 || od < -7)) return false;
    }
    if (fx.no && !s.number.toLowerCase().includes(fx.no.toLowerCase())) return false;
    if (fx.party && !s.partyName.toLowerCase().includes(fx.party.toLowerCase())) return false;
    if (!numOk(Number(s.total), fx.total) || !numOk(Number(s.received), fx.recv) || !numOk(bal, fx.bal)) return false;
    return !s0 || s.number.toLowerCase().includes(s0) || s.partyName.toLowerCase().includes(s0);
  });
  const refresh = () => Promise.all(['sales', 'parties', 'items', 'receipts'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const openRow = (s: SaleRow) => setPreview({ id: s.id });
  const rm = rowMenuHandlers('tr[data-sno]', (tr) => list.data!.find((x) => x.id === tr.dataset.sid), setMenu);

  const doAction = async (a: string, s: SaleRow) => {
    setMenu(null);
    if (a === 'view') return s.cancelled ? openRow(s) : navigate(`/sales/new?edit=${s.id}`);
    if (a === 'prev') return openRow(s);
    if (a === 'einv') return soon('Generate e-Invoice');
    if (a === 'recv') return navigate(`/payments-received?party=${s.party?.id ?? ''}&invoice=${s.id}`);
    if (a === 'plink') return soon('Send payment link');
    if (a === 'ret') return navigate(`/credit-notes?invoice=${s.id}`);
    if (a === 'dch') return setPreview({ id: s.id, challan: true });
    if (a === 'dup') return navigate(`/sales/new?copy=${s.id}`);
    // Open PDF and Print: the same paper through the browser's print window (choose "Save as PDF"; the file is named e.g. "Tax Invoice INV-0101")
    if (a === 'pdf' || a === 'print') { setPreview({ id: s.id }); printNow(); return; }
    if (a === 'del') return askDelete(s);
    if (a === 'hist') return openHistory('sales', s.id, setModal, showToast);
    const d = await qc.fetchQuery({ queryKey: ['sale', s.id], queryFn: () => api<SaleDoc>(`/sales/${s.id}`) });
    if (a === 'cancel') return askCancel(s, d);
    if (a === 'payh') return payHistory(s, d);
  };
  const askCancel = (s: SaleRow, d: SaleDoc) => {
    const recv = money(s.total).minus(s.balance);
    setModal({
      title: `Cancel ${s.number}?`, sub: `${s.partyName} · ₹${inr2f(s.total)}`, ok: 'Cancel invoice', danger: true,
      body: <ul className="slcl"><li>The invoice stays in your records, marked <b>Cancelled</b>.</li><li>Its balance{recv.gt(0) ? '' : ' and total'} no longer count toward the party’s dues.</li>{d.legacy && false ? null : <li>Items go back into stock.</li>}{recv.gt(0) && s.party ? <li>₹{inr2f(recv.toFixed(2))} already received becomes an <b>advance</b> for {s.partyName}.</li> : null}</ul>,
      onOk: async () => {
        try {
          if (!(await withPasscode(qc, cancelAsk(s.number, 'invoice'), (h) => api(`/sales/${s.id}/cancel`, { method: 'POST', body: {}, headers: h })))) return;
          setModal(null);
          await refresh();
          showToast(`${s.number} cancelled`);
        } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not cancel the invoice.'); }
      },
    });
  };
  /** Delete (prototype slConfirm 'del'): undone like cancel, then hidden from the list — kept in the records, never erased. */
  const askDelete = (s: SaleRow) => {
    const recv = s.cancelled ? money(0) : money(s.total).minus(s.balance);
    setModal({
      title: `Delete ${s.number}?`, sub: `${s.partyName} · ₹${inr2f(s.total)}`, ok: 'Delete invoice', danger: true,
      body: <p className="slcl" style={{ margin: 0 }}>{s.cancelled ? 'The invoice is already cancelled. ' : ''}It is hidden from your lists but kept safely in your records. Nothing is erased.{s.cancelled ? null : <> Its items go back into stock{recv.gt(0) ? (s.party ? <>, and ₹{inr2f(recv.toFixed(2))} already received becomes an <b>advance</b> for {s.partyName}</> : <>, and the ₹{inr2f(recv.toFixed(2))} taken with it is refunded</>) : null}.</>}</p>,
      onOk: async () => {
        try {
          if (!(await withPasscode(qc, deleteAsk(s.number, 'invoice'), (h) => api(`/sales/${s.id}/delete`, { method: 'POST', body: {}, headers: h })))) return;
          setModal(null);
          await refresh();
          showToast(`${s.number} deleted`);
        } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not delete the invoice.'); }
      },
    });
  };
  const payHistory = (s: SaleRow, d: SaleDoc) => {
    const rows = d.settlements.filter((x) => !x.cancelled).map((x) => [dmy(x.date), x.kind === 'credit_note' ? `Goods returned · ${x.number}` : x.atSale ? 'Received with invoice' : 'Payment received', x.mode || '—', x.amount] as const);
    const recvNow = s.cancelled ? (d.payment ? d.payment.amount : '0') : money(s.total).minus(s.balance).toFixed(2);
    setModal({
      title: `Payment history · ${s.number}`, sub: `${s.partyName} · Total ₹${inr2f(s.total)}`,
      body: rows.length ? (
        <><div className="tw" style={{ margin: 0 }}><table className="slht"><thead><tr><th>Date</th><th>Entry</th><th>Mode</th><th className="n">Amount</th></tr></thead><tbody>{rows.map((r, k) => <tr key={k}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="n">₹{inr2f(r[3])}</td></tr>)}</tbody></table></div>
          <div className="slhs"><span>Received <b className="pos">₹{inr2f(recvNow)}</b></span><span>{s.cancelled ? 'Cancelled — balance cleared' : <>Balance <b className={Number(s.balance) > 0 ? 'neg' : ''}>₹{inr2f(s.balance)}</b></>}</span></div></>
      ) : <div className="ptempty">No payment received yet. Balance ₹{inr2f(s.balance)}.</div>,
    });
  };

  const thf = (key: 'per' | 'st' | 'due', label: string) => {
    const val = key === 'per' ? per : key === 'st' ? st : due;
    const opts: [string, string][] = key === 'per' ? PER.map(([v, t]) => [v, v === 'custom' ? `${fmShort(range.from)} – ${fmShort(range.to)}` : t]) : key === 'st' ? ST : DUE;
    const on = val !== 'all';
    return (
    <button type="button" className={`thf${on ? ' on' : ''}`} data-thf={key === 'per' ? 'slPerSel' : key === 'st' ? 'slSt' : 'slDueSel'} aria-label={label} title={on ? `Filtered: ${opts.find((o) => o[0] === val)?.[1] ?? ''}` : label} aria-haspopup="true"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); const el = e.currentTarget; setPop((p) => (p && p.anchor.el === el ? null : { kind: key, anchor: { el } })); }}><RawIcon d={FILTER} /></button>
    );
  };
  const xLabel = (key: XKey) => {
    const f = fx[key];
    if (!f) return '';
    if (typeof f === 'string') return `contains “${f}”`;
    return f.op === 'bt' ? `between ₹${inr2f(f.a)} and ₹${inr2f(f.b ?? f.a)}` : `${OPS.find((o) => o[0] === f.op)![1].toLowerCase()} ₹${inr2f(f.a)}`;
  };
  const thx = (key: XKey, label: string) => (
    <button type="button" className={`thf${fx[key] ? ' on' : ''}`} data-thx={key} aria-label={label} title={fx[key] ? `Filtered: ${xLabel(key)}` : label} aria-haspopup="true" aria-expanded="false"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); const el = e.currentTarget; setPop((p) => (p && p.anchor.el === el ? null : { kind: 'x', key, anchor: { el, clamp: true } })); }}><RawIcon d={FILTER} /></button>
  );

  return (
    <section id="vSales">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Sales invoices</h1><div className="sp"></div><button className="btn p" onClick={() => navigate('/sales/new')}><RawIcon d={PLUS} />New invoice <kbd className="kh" style={{ marginLeft: ui.sp(6), background: 'transparent', color: 'inherit', borderColor: 'rgba(255,255,255,.4)' }}>Alt+S</kbd></button></div>

      <div className="card ptxc">
        <div className="ptfil" style={{ padding: ui.sp('14px 16px'), alignItems: 'center' }}>
          <div className={tsOpen ? 'xsr open' : 'xsr'} id="slTsWrap"><button className="ixs" id="slTsBtn" type="button" title="Search invoices" aria-label="Search invoices" aria-expanded={tsOpen} onMouseDown={(e) => tsOpen && e.preventDefault()} onClick={() => { if (!tsOpen) { setTsOpen(true); setTimeout(() => qRef.current?.focus(), 30); } else { setQ(''); setTsOpen(false); } }}><RawIcon d={SEARCH} /></button>
            <input className="fi" id="slTq" placeholder="Search invoice no. or party" autoComplete="off" tabIndex={tsOpen ? 0 : -1} aria-label="Search invoices" ref={qRef} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { if (!q.trim()) setTsOpen(false); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setTsOpen(false); (document.getElementById('slTsBtn') as HTMLElement)?.focus(); } }} /></div>
          <div className="sumrow sumin" id="slSum"><div><small>Sales</small><b>{inr(tot.toFixed(2))}</b></div><div><small>Received</small><b className="pos">{inr(tot.minus(owed).toFixed(2))}</b></div><div><small>Unpaid</small><b className="neg">{inr(owed.toFixed(2))}</b></div><div><small>Invoices</small><b>{live.length}</b></div></div>
          <div className="seg2 sm" id="slPer" hidden>{(['all', 'oct', 'sep'] as const).map((k) => <button data-per={k} className={per === k ? 'on' : ''} key={k} onClick={() => setPer(k)}>{k === 'all' ? 'All' : k === 'oct' ? 'This month' : 'Last month'}</button>)}</div>
          <select id="slPerSel" hidden aria-hidden="true" value={per} onChange={(e) => setPer(e.target.value as Period)}>{PER.map(([v, t]) => <option value={v} key={v}>{v === 'custom' && per === 'custom' ? `${fmShort(range.from)} – ${fmShort(range.to)}` : t}</option>)}</select>
          <select className="fi" hidden id="slSt" aria-label="Filter by status" value={st} onChange={(e) => setSt(e.target.value)}>{ST.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select>
          <select className="fi" hidden id="slDueSel" aria-hidden="true" value={due} onChange={(e) => setDue(e.target.value)}>{DUE.map(([v, t]) => <option value={v} key={v}>{t}</option>)}</select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr>
          <th><span className="thw2">Date{thf('per', 'Filter by date')}</span></th><th><span className="thw2">Invoice no.{thx('no', 'Filter by invoice no')}</span></th><th><span className="thw2">Party{thx('party', 'Filter by party')}</span></th>
          <th className="n"><span className="thw2">Total{thx('total', 'Filter by total')}</span></th><th className="n"><span className="thw2">Received{thx('recv', 'Filter by received')}</span></th><th className="n"><span className="thw2">Balance{thx('bal', 'Filter by balance')}</span></th>
          <th><span className="thw2">Due date{thf('due', 'Filter by due date')}</span></th><th><span className="thw2">Status{thf('st', 'Filter by status')}</span></th><th className="slact"><span className="vh">Actions</span></th></tr></thead>
          <tbody id="slRows"
            onContextMenu={rm.onContextMenu}
            onKeyDown={(e) => {
              // the actions menu: right-click, the menu key or Shift+F10; Enter (or a click) opens the preview (owner decision, 4 Oct 2026)
              if (rm.menuKey(e)) return;
              const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-sno]'); if (!tr) return;
              const r = list.data!.find((x) => x.id === tr.dataset.sid); if (!r) return;
              if (e.key === 'Enter' && e.target === tr) { e.preventDefault(); openRow(r); }
            }}>
            {L.length ? L.map((s) => {
              const stt = statusOf(s);
              const c = s.cancelled;
              return (
                <tr tabIndex={0} data-sno={s.number} data-sid={s.id} data-spid={s.party?.id ?? ''} className={[c ? 'slcan' : '', menu?.row.id === s.id ? 'ctxon' : ''].filter(Boolean).join(' ')} key={s.id} onClick={() => openRow(s)}>
                  <td>{dmy(s.date)}</td><td className="mono">{s.number}{!c ? <> <span className="st b" style={{ fontSize: ui.fs(10), padding: ui.sp('1px 6px') }}>New</span></> : null}</td><td><b style={{ fontWeight: 600 }}>{s.partyName}</b></td>
                  <td className="n">{inr2f(s.total)}</td><td className="n">{inr2f(s.received)}</td><td className="n">{inr2f(s.balance)}</td><td>{!c && Number(s.balance) > 0 && s.dueDate ? dmy(s.dueDate) : ''}</td><td><span className={`stt ${stt.c}`}>{stt.t}</span></td>
                  <td className="slact"><RowMenuButton no={s.number} label={`Actions for ${s.number}`} onOpen={(b) => setMenu({ row: s, ...atButton(b), tr: b.closest('tr') })} /></td></tr>
              );
            }) : <tr><td colSpan={9} className="ptempty">No invoices match. <button className="lnk" onClick={() => navigate('/sales/new')}>Create an invoice</button></td></tr>}
          </tbody></table></div>
      </div>

      <SaleMenu menu={menu} onClose={() => { const tr = menu?.tr; setMenu(null); return tr; }} onPick={(a) => menu && void doAction(a, menu.row)} />
      <ThfPop anchor={pop?.anchor ?? null} onClose={closePop} focus={pop?.kind === 'x' ? '#thxV,#thxA' : pop?.kind === 'range' ? '#thdFrom' : 'button.on,button'}>
        {pop?.kind === 'per' ? <ThfChoices options={PER.map(([v, t]) => [v, v === 'custom' && per === 'custom' ? `${fmShort(range.from)} – ${fmShort(range.to)}` : t])} value={per} onPick={(v) => { if (v === 'custom') setPop({ kind: 'range', anchor: pop.anchor }); else { setPer(v as Period); setPop(null); } }} /> : null}
        {pop?.kind === 'st' ? <ThfChoices options={ST} value={st} onPick={(v) => { setSt(v); setPop(null); }} /> : null}
        {pop?.kind === 'due' ? <ThfChoices options={DUE} value={due} onPick={(v) => { setDue(v); setPop(null); }} /> : null}
        {pop?.kind === 'range' ? <RangeForm initial={range} today={today} onBack={() => setPop({ kind: 'per', anchor: pop.anchor })} onApply={(r) => { setRange(r); setPer('custom'); setPop(null); }} /> : null}
        {pop?.kind === 'x' ? <XForm k={pop.key} cur={fx[pop.key]} names={[...new Set(list.data.map((s) => s.partyName))].sort()} onApply={(v) => { setFx({ ...fx, [pop.key]: v }); const el = pop.anchor.el; setPop(null); el.focus(); }} /> : null}
      </ThfPop>
      <SlModal m={modal} onClose={() => setModal(null)} />
      <InvoicePreview doc={preview && shown.data?.id === preview.id ? shown.data : null} challan={preview?.challan} onClose={() => setPreview(null)} onNew={() => { setPreview(null); navigate('/sales/new'); }} onLink={() => soon('Payment link')} />
    </section>
  );
}

/** Right-click / ⋮ actions for an invoice (#slCtx). */
function SaleMenu({ menu, onClose, onPick }: { menu: { row: SaleRow; x: number; y: number; tr: HTMLElement | null } | null; onClose: () => HTMLElement | null | undefined; onPick: (a: string) => void }) {
  const r = menu?.row;
  const c = !!r?.cancelled;
  const bal = Number(r?.balance ?? 0);
  const off: Record<string, string> = r ? {
    einv: c ? 'Cancelled invoice' : '', recv: c ? 'Cancelled invoice' : !r.party ? 'Counter sale — no party to collect from' : bal <= 0 ? 'Fully paid' : '',
    plink: c ? 'Cancelled invoice' : bal <= 0 ? 'Fully paid' : '', ret: c ? 'Cancelled invoice' : '', cancel: c ? 'Already cancelled' : '',
  } : {};
  return (
    <RowMenu id="slCtx" label="Invoice actions" rows="#slRows tr[data-sno]" menu={menu} head={r ? <><b>{r.number}</b> · {r.partyName}</> : null}
      actions={ACTIONS} off={off} words={c ? { view: 'View' } : undefined} onClose={onClose} onPick={onPick} />
  );
}

export function RangeForm({ initial, today, onBack, onApply }: { initial: { from?: string; to?: string }; today: string; onBack: () => void; onApply: (r: { from?: string; to?: string }) => void }) {
  const fyStart = (() => { const [y, m] = today.split('-').map(Number); return `${m! >= 4 ? y : y! - 1}-04-01`; })();
  // prototype default: from the first of last month to today
  const lastStart = (() => { const [y, m] = today.split('-').map(Number); return m === 1 ? `${y! - 1}-12-01` : `${y}-${String(m! - 1).padStart(2, '0')}-01`; })();
  const [from, setFrom] = useState(initial.from ?? lastStart);
  const [to, setTo] = useState(initial.to ?? today);
  const [err, setErr] = useState('');
  const apply = () => { if (!from && !to) return setErr('Choose at least one date.'); if (from && to && from > to) return setErr('“From” is after “To”.'); onApply({ from, to }); };
  const quick = (k: string) => { if (k === 'fy') setFrom(fyStart); else { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - (Number(k) - 1)); setFrom(d.toISOString().slice(0, 10)); } setTo(today); };
  return (
    <div className="thdr" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}><b>Custom date range</b>
      <label>From<input type="date" className="fi" id="thdFrom" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label><label>To<input type="date" className="fi" id="thdTo" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
      <div className="thdq"><button type="button" data-q="7" onClick={() => quick('7')}>Last 7 days</button><button type="button" data-q="30" onClick={() => quick('30')}>Last 30 days</button><button type="button" data-q="fy" onClick={() => quick('fy')}>This FY</button></div>
      <small className="neg" id="thdErr">{err}</small><div className="thdb"><button type="button" className="btn sm" id="thdBack" onClick={onBack}>Back</button><button type="button" className="btn p sm" id="thdApply" onClick={apply}>Apply</button></div></div>
  );
}

/** Text / amount condition in a column head (prototype SLX). */
function XForm({ k, cur, names, onApply }: { k: XKey; cur: string | NumF; names: string[]; onApply: (v: string | NumF) => void }) {
  const d = SLX[k];
  const [v, setV] = useState(typeof cur === 'string' ? cur : '');
  const n = (typeof cur === 'object' ? cur : null) as NumF;
  const [op, setOp] = useState<'eq' | 'gt' | 'lt' | 'bt'>(n?.op ?? 'gt');
  const [a, setA] = useState(n ? String(n.a) : '');
  const [b, setB] = useState(n?.b != null ? String(n.b) : '');
  const [err, setErr] = useState('');
  const apply = (clear: boolean) => {
    if (clear) return onApply(d.t === 'text' ? '' : null);
    if (d.t === 'text') return onApply(v.trim());
    if (a.trim() === '' || isNaN(+a)) return setErr('Enter an amount.');
    if (op === 'bt' && (b.trim() === '' || isNaN(+b))) return setErr('Enter the second amount.');
    onApply({ op, a: +a, b: op === 'bt' ? +b : null });
  };
  const foot = <><small className="neg" id="thxErr">{err}</small><div className="thdb"><button type="button" className="btn sm" id="thxClr" onClick={() => apply(true)}>Clear</button><button type="button" className="btn p sm" id="thxOk" onClick={() => apply(false)}>Apply</button></div></>;
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && /^(INPUT|SELECT)$/.test((e.target as HTMLElement).tagName)) { e.preventDefault(); apply(false); } };
  return d.t === 'text' ? (
    <div className="thdr" data-k={k} onKeyDown={enter}><b>Filter by {d.lab.toLowerCase()}</b><label>Contains<input className="fi" id="thxV" value={v} onChange={(e) => setV(e.target.value)} list={k === 'party' ? 'thxPL' : undefined} autoComplete="off" placeholder={k === 'party' ? 'Party name' : 'e.g. 041'} /></label>
      {k === 'party' ? <datalist id="thxPL">{names.map((x) => <option value={x} key={x} />)}</datalist> : null}{foot}</div>
  ) : (
    <div className="thdr" data-k={k} onKeyDown={enter}><b>Filter by {d.lab.toLowerCase()}</b><label>Condition<select className="fi" id="thxOp" value={op} onChange={(e) => setOp(e.target.value as typeof op)}>{OPS.map(([x, t]) => <option value={x} key={x}>{t}</option>)}</select></label>
      <div className="thx2"><label>Amount (₹)<input className="fi" id="thxA" inputMode="decimal" autoComplete="off" value={a} onChange={(e) => setA(e.target.value)} /></label><label id="thxBL" hidden={op !== 'bt'}>And (₹)<input className="fi" id="thxB" inputMode="decimal" autoComplete="off" value={b} onChange={(e) => setB(e.target.value)} /></label></div>{foot}</div>
  );
}
