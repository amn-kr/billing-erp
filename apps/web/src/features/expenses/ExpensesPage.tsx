/**
 * Expenses (#vExp) — the prototype's renderExp with the Add / Edit expense window (#xpm,
 * xpOpen / xpLines / xpSave) and Expense categories (#xcm, xcOpen / xcRender). Money taken
 * out in the cash / bank book for shop expenses, salary or bank charges is listed too ("Book").
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BOOK_EXPENSE_CATEGORY, XP_GST, XP_MODES, expenseTotals } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { useFitTables } from '../../lib/useFitTables';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon, RawIcon } from '../../components/Icon';
import { useDiscardGuard } from '../../components/Discard';
import { useSettings } from '../../lib/settings';
import { useShell } from '../shell/store';
import { inPeriod } from '../sales/model';
import { SlModal, type SlModalProps } from '../sales/SlModal';
import type { Party } from '../parties/PartiesPage';
import { useEntryView } from '../banking/BankingPages';
import { BK_KEYS, useAccounts, type Account, type BkPer } from '../banking/model';

export interface ExpenseRow {
  key: string; id: string; src: 'ex' | 'bt'; number: string; date: string; category: string; categoryId: string | null; payee: string; mode: string;
  accountId: string | null; reference: string; notes: string; total: string; gst: string; lines: { name: string; qty: string; rate: string; gst: number; amt: string }[];
}
interface Cat { id: string; name: string; fixed: boolean }

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const KBD = { marginLeft: 6, background: 'transparent', color: 'inherit', borderColor: 'rgba(255,255,255,.4)' };
const PER_TXT: Record<BkPer, string> = { all: 'all time', oct: 'this month', sep: 'last month' };
const EX_KEYS = ['expenses', 'expense-categories', 'next-number', ...BK_KEYS];
const BOOK_CAT = Object.fromEntries(Object.entries(BOOK_EXPENSE_CATEGORY).map(([k, v]) => [v, k]));

export const useExpenses = () => useQuery({ queryKey: ['expenses'], queryFn: () => api<ExpenseRow[]>('/expenses') });
const useCats = () => useQuery({ queryKey: ['expense-categories'], queryFn: () => api<Cat[]>('/expense-categories') });

export function ExpensesPage() {
  useFitTables();
  const all = useExpenses();
  const cats = useCats();
  const accts = useAccounts();
  const gst = !!useSettings().data?.gstEnabled;
  const [q, setQ] = useState('');
  const [per, setPer] = useState<BkPer>('all');
  const [cat, setCat] = useState('all');
  const [acct, setAcct] = useState('all');
  const [xp, setXp0] = useState<{ row?: ExpenseRow; cat?: string } | null>(null);
  // each opening is a fresh window (nothing typed yet), as the prototype's xpOpen
  const [xpN, setXpN] = useState(0);
  const setXp = (v: { row?: ExpenseRow; cat?: string } | null) => { if (v) setXpN((n) => n + 1); setXp0(v); };
  const [xc, setXc] = useState<{ back: boolean } | null>(null);
  const [modal, setModal] = useState<SlModalProps | null>(null);
  const ev = useEntryView(accts.data ?? []);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  // "New expense" from the + menu, the sidebar or Alt+E
  useEffect(() => { if (params.get('new')) { setXp({}); setParams({}, { replace: true }); } }, [params, setParams]);
  if (!all.data || !cats.data || !accts.data) return <section id="vExp"></section>;
  const aName = (id: string | null) => accts.data.find((a) => a.id === id)?.name ?? '—';
  const P = all.data.filter((x) => inPeriod(x.date, per));
  const inCat = P.filter((x) => cat === 'all' || x.category === cat);
  const s = q.toLowerCase();
  const L = inCat.filter((x) => (acct === 'all' || x.accountId === acct) && (!s || [x.number, x.payee, x.category, x.reference, x.notes, ...x.lines.map((l) => l.name)].join(' ').toLowerCase().includes(s)));
  const tot = L.reduce((a, x) => a + Number(x.total), 0), gt = L.reduce((a, x) => a + Number(x.gst), 0);
  const cashId = accts.data.find((a) => a.kind === 'cash')?.id;
  const cash = L.filter((x) => x.accountId === cashId).reduce((a, x) => a + Number(x.total), 0);
  const by = new Map<string, { t: number; n: number }>();
  P.forEach((x) => { const o = by.get(x.category) ?? { t: 0, n: 0 }; o.t += x.total ? Number(x.total) : 0; o.n++; by.set(x.category, o); });
  const C = [...by.entries()].sort((a, b) => b[1].t - a[1].t);
  const ptot = P.reduce((a, x) => a + Number(x.total), 0);
  const mx = C.length ? C[0]![1].t : 1;
  const open = (x: ExpenseRow) => {
    if (x.src === 'ex') return setXp({ row: x });
    const a = accts.data.find((y) => y.id === x.accountId);
    if (a) void ev.open({ key: x.key, date: x.date, amt: '-' + x.total, kind: BOOK_CAT[x.category] ?? x.category, party: x.payee, doc: x.number, mode: '', ref: x.reference, note: '', src: 'bank_entry', sourceId: x.id, run: '0' }, a);
  };
  return (
    <section id="vExp">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Expenses</h1><span className="pttot" id="exTotTxt">Money spent running the shop</span><div className="sp"></div><button className="btn" id="exCats" onClick={() => setXc({ back: false })}><Icon name="gear" />Categories</button><button className="btn p" id="exNew" onClick={() => setXp({ cat: cat !== 'all' ? cat : undefined })}><RawIcon d={PLUS} />Add expense <kbd className="kh" style={KBD}>Alt+E</kbd></button></div>
      <div className="sumrow" id="exSum"><div className="card" style={{ padding: '14px 16px' }}><small>Spent {PER_TXT[per]}</small><b className="neg">{inr(tot.toFixed(2))}</b></div><div className="card" style={{ padding: '14px 16px' }}><small>Entries</small><b>{L.length}</b></div><div className="card" style={{ padding: '14px 16px' }}><small>Paid in cash</small><b>{inr(cash.toFixed(2))}</b></div><div className="card needs-gst" style={{ padding: '14px 16px' }}><small>GST input credit</small><b className="pos">{inr2f(gt.toFixed(2))}</b></div></div>
      <div className="exwrap"><div className="card ptxc"><div className="ptfil" style={{ padding: '12px 16px', alignItems: 'center' }}><label className="search" htmlFor="exQ" style={{ maxWidth: 280, height: 36 }}><RawIcon d={SEARCH} /><input id="exQ" placeholder="Search payee, item, bill no." autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="seg2 sm" id="exPer">{(['all', 'oct', 'sep'] as const).map((k) => <button data-per={k} className={per === k ? 'on' : ''} key={k} onClick={() => setPer(k)}>{k === 'all' ? 'All' : k === 'oct' ? 'This month' : 'Last month'}</button>)}</div>
        <select className="fi" id="exCat" aria-label="Category" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All categories</option>{cats.data.map((c) => <option key={c.id}>{c.name}</option>)}</select>
        <select className="fi" id="exAcct" aria-label="Paid from" style={{ width: 'auto' }} value={acct} onChange={(e) => setAcct(e.target.value)}><option value="all">Paid from: any</option>{accts.data.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Exp. no.</th><th>Category</th><th>Paid to · details</th><th>Paid from</th><th className="n">Amount</th></tr></thead>
          <tbody id="exRows" onKeyDown={(e) => { const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-exk]'); if (tr && e.key === 'Enter' && e.target === tr) { e.preventDefault(); tr.click(); } }}>
            {L.length ? L.map((x) => {
              const d = x.lines.map((l) => l.name).filter(Boolean).join(', ');
              return (
                <tr tabIndex={0} data-exk={x.key} data-exa={x.accountId ?? ''} key={x.key} onClick={() => open(x)}><td>{dmy(x.date)}</td><td className="mono">{x.number}{x.src === 'bt' ? <span className="st b exsrc" title="Entered in the cash / bank book">Book</span> : null}</td><td>{x.category}</td>
                  <td><div className="expd"><b style={{ fontWeight: 600 }}>{x.payee || x.category}</b></div>{d && d !== x.payee ? <small className="mu expd">{d}</small> : null}</td>
                  <td>{aName(x.accountId)}{x.mode && x.mode !== 'Bank' ? <small className="mu">{x.mode}</small> : null}</td><td className="n"><b>{inr2f(x.total)}</b>{Number(x.gst) ? <small className="mu needs-gst">GST {inr2f(x.gst)}</small> : null}</td></tr>
              );
            }) : <tr><td colSpan={6}><div className="ptempty pue"><b>{all.data.length ? 'No expenses match' : 'No expenses yet'}</b><span>Record rent, salaries, bills and other spending. Each entry also comes out of your cash or bank book.</span><button className="btn p sm" id="exNew2" onClick={() => setXp({})}>Add expense</button></div></td></tr>}
          </tbody></table></div></div>
        <aside className="card excat"><h3>By category</h3><small className="mu" id="exCatSub">{`${inr(ptot.toFixed(2))} across ${C.length} categor${C.length === 1 ? 'y' : 'ies'} · ${PER_TXT[per]}`}</small>
          <div className="excl" id="exCatList"><button type="button" className={`excb${cat === 'all' ? ' on' : ''}`} data-excat="all" onClick={() => setCat('all')}><span>All categories</span><b>{inr(ptot.toFixed(2))}</b></button>
            {C.length ? C.map(([c, o]) => <button type="button" className={`excb${cat === c ? ' on' : ''}`} data-excat={c} key={c} onClick={() => setCat(cat === c ? 'all' : c)}><span>{c}</span><b>{inr(o.t.toFixed(2))}</b><i><em style={{ width: `${Math.max(3, (o.t / mx) * 100)}%` }}></em></i><small>{o.n} entr{o.n === 1 ? 'y' : 'ies'} · {ptot ? Math.round((o.t / ptot) * 100) : 0}%</small></button>)
              : <p className="mu" style={{ fontSize: 13, margin: '8px 10px' }}>Nothing spent in this period.</p>}</div></aside></div>
      <ExpenseDialog key={xpN} open={xp} all={all.data} cats={cats.data} accounts={accts.data} gst={gst} onClose={() => setXp(null)} onNewCat={() => { setXp(null); setXc({ back: true }); }} onAgain={(c) => setXp({ cat: c })}
        onCancel={(x) => { setXp(null); setModal({ title: `Cancel ${x.number}?`, sub: `${x.category} · ${dmy(x.date)} · ${inr2f(x.total)}`, body: <p style={{ margin: 0 }}>The amount goes back into {aName(x.accountId)}.</p>, ok: 'Cancel expense', danger: true, cancel: 'Keep it', onOk: () => void cancelX(x) }); }} />
      <CategoriesDialog open={xc} all={all.data} cats={cats.data} onClose={(added) => { const back = xc?.back; setXc(null); if (back && added) setXp({ cat: added }); }} />
      <SlModal m={modal ?? ev.modal} onClose={() => { setModal(null); ev.setModal(null); }} />
    </section>
  );
  async function cancelX(x: ExpenseRow) {
    try {
      await api(`/expenses/${x.id}/cancel`, { method: 'POST', body: {} });
      setModal(null);
      await Promise.all(EX_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      useShell.getState().showToast(`${x.number} cancelled`);
    } catch (e) { useShell.getState().showToast(e instanceof ApiError ? e.message : 'Could not cancel the expense.'); }
  }
}

/* ───────── Add / edit expense (prototype xpm) ───────── */
type XL = { name: string; qty: string; rate: string; gst: string; amt: string };
const blank = (): XL => ({ name: '', qty: '1', rate: '', gst: '0', amt: '' });
const r2 = (n: number) => Math.round(n * 100) / 100;

function ExpenseDialog({ open, all, cats, accounts, gst, onClose, onNewCat, onAgain, onCancel }: {
  open: { row?: ExpenseRow; cat?: string } | null; all: ExpenseRow[]; cats: Cat[]; accounts: Account[]; gst: boolean;
  onClose: () => void; onNewCat: () => void; onAgain: (cat: string) => void; onCancel: (x: ExpenseRow) => void;
}) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const x = open?.row;
  const [cat, setCat] = useState('');
  const [date, setDate] = useState(today());
  const [payee, setPayee] = useState('');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('Cash');
  const [acct, setAcct] = useState('');
  const [lines, setLines] = useState<XL[]>([blank()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const no = useQuery({ queryKey: ['next-number', 'expense'], queryFn: () => api<{ number: string }>('/expenses/next-number'), enabled: !!open && !x });
  const parties = useQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties'), enabled: !!open });
  useOpenFocus(!!open, ref);
  const close = useDiscardGuard(!!open, ref, 'expense', onClose);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.getElementById('dcf')?.hidden !== false) closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  const cashId = accounts.find((a) => a.kind === 'cash')?.id ?? '';
  const defBank = (accounts.filter((a) => a.kind === 'bank').find((a) => a.isDefault) ?? accounts.find((a) => a.kind === 'bank') ?? accounts[0])?.id ?? '';
  useEffect(() => {
    if (!open) return;
    setCat(x ? x.category : open.cat ?? ''); setDate(x ? x.date : today()); setPayee(x?.payee ?? ''); setRefNo(x?.reference ?? ''); setNote(x?.notes ?? '');
    setMode(x ? x.mode : 'Cash'); setAcct(x ? x.accountId ?? cashId : cashId);
    setLines(x ? x.lines.map((l) => ({ name: l.name, qty: l.qty, rate: String(Number(l.rate)), gst: String(l.gst), amt: String(Number(l.amt)) })) : [blank()]); setErr('');
    setTimeout(() => ((x || open.cat ? document.querySelector('#xpLines input') : document.getElementById('xpCat')) as HTMLElement | null)?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const exps = all.filter((e) => e.src === 'ex');
  const payees = [...new Set([...exps.map((e) => e.payee).filter(Boolean), ...(parties.data ?? []).filter((p) => p.kind === 'supplier').map((p) => p.name)])];
  const items = [...new Set(exps.filter((e) => !cat || e.category === cat).flatMap((e) => e.lines.map((l) => l.name)).filter(Boolean))].slice(0, 60);
  const t = expenseTotals(lines.map((l) => ({ amt: Number(l.amt) || 0, gst: Number(l.gst) || 0 })));
  const setLine = (i: number, f: keyof XL, v: string) => setLines((L) => L.map((l, k) => {
    if (k !== i) return l;
    const n = { ...l, [f]: v };
    const q = Number(n.qty) || 0;
    if (f === 'qty' || f === 'rate') { if (q && n.rate !== '') n.amt = String(r2(q * (Number(n.rate) || 0))); }
    else if (f === 'amt') n.rate = q ? String(r2((Number(n.amt) || 0) / q)) : n.amt;
    return n;
  }));
  const addLine = () => { setLines((L) => [...L, blank()]); setTimeout(() => (document.querySelector('#xpLines tr:last-child input') as HTMLElement | null)?.focus(), 0); };
  const save = async (again: boolean) => {
    const c = cats.find((k) => k.name === cat);
    if (!c) { setErr('Choose a category.'); return document.getElementById('xpCat')?.focus(); }
    if (!date) return setErr('Pick the date.');
    setBusy(true);
    try {
      const r = await api<{ number: string; total: string; account: string | null }>(x ? `/expenses/${x.id}` : '/expenses', { method: x ? 'PUT' : 'POST', body: { categoryId: c.id, date, payee: payee.trim(), reference: refNo.trim(), notes: note.trim(), mode, accountId: acct || null, lines } });
      await Promise.all(EX_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`${r.number} saved · ${inr2f(r.total)} from ${accounts.find((a) => a.id === r.account)?.name ?? '—'}`);
      if (again) onAgain(cat); else onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save the expense.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="ov c" id="xpm" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'xpm') close(); }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(false); } }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="xpT" style={{ width: 'min(760px,100%)' }}>
        <div className="dh"><div><h3 id="xpT" style={{ margin: 0, fontSize: 18 }}>{x ? 'Edit expense' : 'Add expense'}</h3><small className="mu mono" id="xpNo">{x ? x.number : no.data?.number ?? ''}</small></div><button className="ib" type="button" id="xpClose" aria-label="Close" onClick={close}><Icon name="x" /></button></div>
        <div className="two" style={{ marginTop: 14 }}><label className="fl" htmlFor="xpCat">Category<select className="fi" id="xpCat" value={cat} onChange={(e) => { if (e.target.value === '__new') return onNewCat(); setCat(e.target.value); setTimeout(() => { const n = document.querySelector<HTMLInputElement>('#xpLines [data-f="name"]'); if (n && !n.value) n.focus(); }, 0); }}><option value="">Choose category</option>{cats.map((c) => <option key={c.id}>{c.name}</option>)}<option value="__new">+ New category…</option></select></label>
          <label className="fl" htmlFor="xpDate">Date<input className="fi" type="date" id="xpDate" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        <div className="two"><label className="fl" htmlFor="xpPayee">Paid to <span className="mu">(optional)</span><input className="fi" id="xpPayee" list="xpPayL" placeholder="Shop, person or supplier" autoComplete="off" value={payee} onChange={(e) => setPayee(e.target.value)} /><datalist id="xpPayL">{payees.map((p) => <option value={p} key={p} />)}</datalist></label>
          <label className="fl" htmlFor="xpRef">Bill / reference no.<input className="fi" id="xpRef" placeholder="Bill no., UTR, cheque no." autoComplete="off" value={refNo} onChange={(e) => setRefNo(e.target.value)} /></label></div>
        <div className="tw" style={{ margin: '2px 0 0' }}><table className="exlt"><thead><tr><th>Item / description</th><th className="n" style={{ width: 80 }}>Qty</th><th className="n" style={{ width: 110 }}>Rate</th><th className="n needs-gst" style={{ width: 90 }}>GST</th><th className="n" style={{ width: 130 }}>Amount</th><th></th></tr></thead>
          <tbody id="xpLines">{lines.map((l, i) => (
            <tr data-xl={i} key={i}><td><input className="fi" data-f="name" value={l.name} list="xpItemL" placeholder={i ? '' : 'e.g. Shop rent, diesel, salary'} autoComplete="off" aria-label={`Item ${i + 1}`} onChange={(e) => setLine(i, 'name', e.target.value)} /></td>
              <td className="n"><input className="fi n" data-f="qty" value={l.qty} inputMode="decimal" aria-label="Quantity" onChange={(e) => setLine(i, 'qty', e.target.value)} /></td>
              <td className="n"><input className="fi n" data-f="rate" value={l.rate} inputMode="decimal" placeholder="0" aria-label="Rate" onChange={(e) => setLine(i, 'rate', e.target.value)} /></td>
              <td className="n needs-gst"><select className="fi" data-f="gst" aria-label="GST rate" disabled={!gst} value={l.gst} onChange={(e) => setLine(i, 'gst', e.target.value)}>{XP_GST.map((r) => <option value={String(r)} key={r}>{r ? r + '%' : 'None'}</option>)}</select></td>
              <td className="n"><input className="fi n" data-f="amt" value={l.amt} inputMode="decimal" placeholder="0.00" aria-label="Amount" onChange={(e) => setLine(i, 'amt', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && i === lines.length - 1 && (Number(l.amt) || 0) > 0) { e.preventDefault(); addLine(); } }} /></td>
              <td className="x">{lines.length > 1 ? <button className="ib" type="button" data-xlx={i} aria-label="Remove line" onClick={() => setLines((L) => L.filter((_, k) => k !== i))}><Icon name="x" /></button> : null}</td></tr>
          ))}</tbody></table></div>
        <button className="btn sm exadd" type="button" id="xpAddL" onClick={addLine}><RawIcon d={PLUS} />Add line</button><datalist id="xpItemL">{items.map((n) => <option value={n} key={n} />)}</datalist>
        <div className="exacc" style={{ marginTop: 12 }}><label className="fl" htmlFor="xpMode">Paid by<select className="fi" id="xpMode" value={mode} onChange={(e) => { const m = e.target.value; setMode(m); if (m === 'Cash') setAcct(cashId); else if (acct === cashId) setAcct(defBank); }}>{XP_MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="fl" htmlFor="xpAcct">Paid from<select className="fi" id="xpAcct" value={acct} onChange={(e) => { const v = e.target.value; setAcct(v); if (v === cashId) setMode('Cash'); else if (mode === 'Cash') setMode('UPI'); }}>{accounts.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label></div>
        <label className="fl" htmlFor="xpNote">Note<input className="fi" id="xpNote" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="extot" id="xpTot"><span className="mu">Total</span><b>{inr2f(t.total.toFixed(2))}</b>{t.gst.gt(0) && gst ? <small className="mu needs-gst">includes GST {inr2f(t.gst.toFixed(2))} · claim as input credit</small> : null}</div><div className="msg bad" id="xpErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>{/* deliberate difference: expenses are cancelled, never deleted */}<button className="btn dz" type="button" id="xpDel" hidden={!x} style={x ? undefined : { display: 'none' }} onClick={() => x && onCancel(x)}>Cancel expense</button><span style={{ flex: 1 }}></span><button className="btn" type="button" id="xpCancel" onClick={close}>Cancel</button><button className="btn" type="button" id="xpSaveNew" style={x ? { display: 'none' } : undefined} disabled={busy} onClick={() => void save(true)}>Save &amp; new</button><button className="btn p" type="button" id="xpSave" disabled={busy} onClick={() => void save(false)}>Save expense</button></div>
      </div>
    </div>
  );
}

/* ───────── Expense categories (prototype xcm) ───────── */
function CategoriesDialog({ open, all, cats, onClose }: { open: { back: boolean } | null; all: ExpenseRow[]; cats: Cat[]; onClose: (added?: string) => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const [nw, setNw] = useState('');
  useOpenFocus(!!open, ref);
  useEffect(() => { if (open) { setNw(''); setTimeout(() => (document.getElementById('xcNew') as HTMLElement | null)?.focus(), 30); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  const n = new Map<string, { c: number; t: number }>();
  all.forEach((x) => { const o = n.get(x.category) ?? { c: 0, t: 0 }; o.c++; o.t += Number(x.total); n.set(x.category, o); });
  const refresh = () => Promise.all(EX_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const add = async () => {
    const v = nw.trim();
    if (!v) return;
    try {
      await api('/expense-categories', { method: 'POST', body: { name: v } });
      setNw(''); await refresh(); showToast(`${v} added`);
      if (open?.back) onClose(v);
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not add the category.'); }
  };
  const rename = async (c: Cat, v: string, el: HTMLInputElement) => {
    v = v.trim();
    if (!v || v === c.name) { el.value = c.name; return; }
    try { await api(`/expense-categories/${c.id}`, { method: 'PUT', body: { name: v } }); await refresh(); showToast(`Renamed to ${v}`); }
    catch (e) { el.value = c.name; showToast(e instanceof ApiError ? e.message : 'Could not rename the category.'); }
  };
  const remove = async (c: Cat) => {
    try { await api(`/expense-categories/${c.id}/remove`, { method: 'POST', body: {} }); await refresh(); showToast(`${c.name} removed`); }
    catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not remove the category.'); }
  };
  return (
    <div className="ov c" id="xcm" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'xcm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="xcT" style={{ width: 'min(520px,100%)' }}>
        <div className="dh"><div><h3 id="xcT" style={{ margin: 0, fontSize: 18 }}>Expense categories</h3><small className="mu">Rename a category to fix it on every entry.</small></div><button className="ib" type="button" id="xcClose" aria-label="Close" onClick={() => onClose()}><Icon name="x" /></button></div>
        <div style={{ display: 'flex', gap: 8, margin: '14px 0 6px' }}><input className="fi" id="xcNew" placeholder="New category, e.g. Generator diesel" autoComplete="off" style={{ margin: 0, flex: 1 }} value={nw} onChange={(e) => setNw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} /><button className="btn p" type="button" id="xcAdd" onClick={() => void add()}>Add</button></div>
        <div id="xcList" style={{ maxHeight: '52vh', overflow: 'auto' }}>{cats.map((c, i) => {
          const u = n.get(c.name);
          return (
            <div className="xcrow" key={c.id}><input className="fi" defaultValue={c.name} key={c.name} data-xci={i} aria-label="Category name" readOnly={c.fixed} title={c.fixed ? 'Also used by the cash and bank book, so it keeps this name' : undefined} onBlur={(e) => { if (!c.fixed) void rename(c, e.target.value, e.target); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <small className="mu">{u ? `${u.c} · ${inr(u.t.toFixed(2))}` : 'Not used'}</small>{u || c.fixed ? <span style={{ width: 36 }}></span> : <button className="ib" type="button" data-xcx={i} aria-label={`Delete ${c.name}`} onClick={() => void remove(c)}><Icon name="x" /></button>}</div>
          );
        })}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" type="button" id="xcDone" onClick={() => onClose()}>Done</button></div>
      </div>
    </div>
  );
}
