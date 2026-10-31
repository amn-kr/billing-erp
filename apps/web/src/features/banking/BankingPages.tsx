/**
 * Banking & cash — the prototype's Bank accounts (#vBks, renderBks) and Cash in hand
 * (#vCash, renderCash) pages with their shared ledger card (ledCard / ledRender), the
 * account window (#bam), Move money (#bmm), Count cash and the entry details window.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BANK_CATEGORIES, BANK_TYPES } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { useFitTables } from '../../lib/useFitTables';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useEscape } from '../../lib/useEscape';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { inPeriod } from '../sales/model';
import { SlModal, type SlModalProps } from '../sales/SlModal';
import { HIST_ACTION, openHistory, type HistoryType } from '../../components/EditHistory';
import { receiptModal, type Receipt } from '../sales/PaymentsReceivedPage';
import { BK_KEYS, bkCol, bkMask, ledger, tint, useAccounts, useBook, type Account, type BkPer, type Book, type BookEntry } from './model';
import { cancelAsk, editAsk, withPasscode } from '../settings/passcode';
import { atButton, RowMenu, RowMenuButton, rowMenuHandlers, type RowAction, type RowMenuAt } from '../../components/RowMenu';
import { ui } from '../../styles/uiSize';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const PER: [BkPer, string][] = [['all', 'All'], ['oct', 'This month'], ['sep', 'Last month']];
export type Move = { kind: 'transfer' | 'deposit' | 'withdraw' | 'in' | 'out'; acct?: string; cat?: string; edit?: EntryDoc };
/** A saved entry typed by hand; `locked` says why it can't be changed ('' when it can). */
export interface EntryDoc { id: string; number: string; date: string; kind: Move['kind']; accountId: string; toAccountId: string | null; amount: string; category: string; note: string; reference: string; cancelled: boolean; locked: string }
/** After a hand entry is saved or changed: the books, and the Expenses page (shop expenses, salary, bank charges). */
const ENTRY_KEYS = [...BK_KEYS, 'expenses'];
const BOOK_ACT: RowAction[] = [['edit', 'Edit'], ['view', 'View'], HIST_ACTION];

/** Why a book row is not changed from the book ('' when Edit opens it); its own page changes it. */
export function bookEditOff(e: BookEntry): string {
  if (e.src === 'bank_entry' || e.src === 'expense') return '';
  if (e.src === 'payment') return Number(e.amt) > 0 ? 'A payment received. Change it on Payments received.' : 'A payment made. Change it on Payments made.';
  if (e.src === 'sales_document') return 'Money for goods returned. Change it from its credit note.';
  if (e.src === 'cheque') return 'A cheque cleared or bounced. Use Undo on the Cheques page.';
  if (e.src === 'commission_payout') return 'Commission paid. It can’t be changed here.';
  return 'This entry can’t be changed here.';
}
/** Whose edit history a book row shows: its own document's (null: that kind of entry is never edited). */
export function bookHistory(e: BookEntry): HistoryType | null {
  if (e.src === 'bank_entry') return 'bank-entry';
  if (e.src === 'expense') return 'expense';
  if (e.src === 'payment') return Number(e.amt) > 0 ? 'receipt' : 'payment-made';
  if (e.src === 'sales_document') return 'sales';
  return null;
}
/** Rows that open a details window when clicked. */
const viewOff = (e: BookEntry) => (e.src === 'payment' || e.src === 'bank_entry' ? '' : 'Use Edit to open it.');

/* ───────── the ledger card (prototype ledCard + ledRender) ───────── */
function LedgerCard({ p, a, book, head, onEntry, onEdit, onHistory, per, setPer }: { p: 'bk' | 'ca'; a: Account; book: Book; head: (r: ReturnType<typeof ledger>) => React.ReactNode; onEntry: (e: BookEntry) => void; onEdit: (e: BookEntry) => void; onHistory: (e: BookEntry) => void; per: BkPer; setPer: (p: BkPer) => void }) {
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<RowMenuAt<BookEntry> | null>(null);
  const [ty, setTy] = useState('all');
  const r = ledger(book, per);
  const s = q.toLowerCase();
  const R = r.P.filter((e) => (ty === 'all' || (ty === 'in' ? Number(e.amt) > 0 : Number(e.amt) < 0)) && (!s || [e.kind, e.party, e.ref, e.doc, e.note, e.mode].join(' ').toLowerCase().includes(s))).reverse();
  const rm = rowMenuHandlers('tr[data-bke]', (tr) => R.find((e) => e.key === tr.dataset.bke), setMenu);
  const m = menu?.row;
  return (
    <div className="card ptxc bkled"><div className="bkhd" id={`${p}Hd`}>{head(r)}</div>
      <div className="ptfil" style={{ padding: ui.sp('12px 16px'), alignItems: 'center' }}><label className="search" htmlFor={`${p}Q`} style={{ maxWidth: 280, height: ui.h(36) }}><RawIcon d={SEARCH} /><input id={`${p}Q`} placeholder="Search party, reference, note" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="seg2 sm" id={`${p}Per`}>{PER.map(([k, t]) => <button data-per={k} className={per === k ? 'on' : ''} key={k} onClick={() => setPer(k)}>{t}</button>)}</div>
        <select className="fi" id={`${p}Ty`} aria-label="Show" style={{ width: 'auto' }} value={ty} onChange={(e) => setTy(e.target.value)}><option value="all">Money in &amp; out</option><option value="in">Money in</option><option value="out">Money out</option></select></div>
      <div className="tw" style={{ margin: 0 }}><table className="ptt2 bkt"><thead><tr><th>Date</th><th>Particulars</th><th>Voucher</th><th>Mode / ref</th><th className="n">Money in</th><th className="n">Money out</th><th className="n">Balance</th><th className="slact"><span className="vh">Actions</span></th></tr></thead>
        <tbody id={`${p}Rows`} onContextMenu={rm.onContextMenu} onKeyDown={(e) => { if (rm.menuKey(e)) return; const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-bke]'); if (tr && e.key === 'Enter' && e.target === tr) { e.preventDefault(); tr.click(); } }}>
          {R.length ? R.map((e) => {
            const amt = Number(e.amt), run = Number(e.run);
            return (
              <tr tabIndex={0} data-bke={e.key} data-bka={a.id} key={e.key} className={m?.key === e.key ? 'ctxon' : undefined} onClick={() => onEntry(e)}><td>{dmy(e.date)}</td><td><b className="bkpn">{e.party || e.kind}</b><small className="mu">{e.party ? e.kind : ''}{e.note && e.party !== e.note ? (e.party ? ' · ' : '') + e.note : ''}</small></td>
                <td className="mono mu">{e.doc}</td><td className="mu">{[e.mode, e.ref].filter(Boolean).join(' · ') || '—'}</td><td className="n pos">{amt > 0 ? inr2f(amt) : ''}</td><td className="n neg">{amt < 0 ? inr2f(-amt) : ''}</td><td className="n"><b className={run < 0 ? 'neg' : ''}>{inr2f(run)}</b></td>
                <td className="slact"><RowMenuButton no={e.key} label={`Actions for ${e.doc || e.kind}`} onOpen={(b) => setMenu({ row: e, ...atButton(b), tr: b.closest('tr') })} /></td></tr>
            );
          }) : <tr><td colSpan={8} className="ptempty">{book.entries.length ? 'No entries match.' : 'No money has moved in this account yet.'}</td></tr>}
          {ty === 'all' && !s ? <tr className="bkopen"><td>{r.start ? dmy(r.start) : dmy(a.openingDate)}</td><td colSpan={5}><b>Opening balance</b></td><td className="n"><b>{inr2f(r.openB)}</b></td><td className="slact"></td></tr> : null}
        </tbody></table></div>
      <RowMenu id={`${p}Ctx`} label="Entry actions" rows={`#${p}Rows tr[data-bke]`} menu={menu} head={m ? <><b>{m.doc || m.kind}</b> · {m.party || m.kind}</> : null} actions={BOOK_ACT}
        off={m ? { edit: bookEditOff(m), view: viewOff(m), hist: bookHistory(m) ? '' : 'This entry is never edited, so it has no history.' } : undefined} onClose={() => { const tr = menu?.tr; setMenu(null); return tr; }}
        onPick={(k) => { const e = menu?.row; setMenu(null); if (!e) return; if (k === 'edit') onEdit(e); else if (k === 'hist') onHistory(e); else onEntry(e); }} />
    </div>
  );
}

/** Opens a book entry: the receipt, the payment, or a hand entry that can be cancelled (prototype bkView). */
export function useEntryView(accounts: Account[]) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [modal, setModal] = useState<SlModalProps | null>(null);
  const name = (id: string | null) => accounts.find((x) => x.id === id)?.name ?? '';
  const nav = useNavigate();
  /**
   * Edit from a book row: an expense opens on the Expenses page; a hand entry resolves to the saved
   * entry for Move money (null, with the reason said, when it can't be changed).
   */
  const edit = async (e: BookEntry): Promise<EntryDoc | null> => {
    if (e.src === 'expense') { nav('/expenses', { state: { open: 'EX:' + e.doc } }); return null; }
    const off = bookEditOff(e);
    if (off) { showToast(off); return null; }
    const t = await api<EntryDoc>(`/banking/entries/${e.sourceId}`);
    if (t.locked) { showToast(t.locked); return null; }
    return t;
  };
  const open = async (e: BookEntry, acct: Account) => {
    if (e.src === 'payment' && Number(e.amt) > 0) {
      const L = await qc.fetchQuery({ queryKey: ['receipts'], queryFn: () => api<Receipt[]>('/receipts') });
      const x = L.find((r) => r.id === e.sourceId);
      if (x) setModal(receiptModal(x));
      return;
    }
    if (e.src === 'payment') {
      return setModal({ title: `Payment ${e.doc}`, sub: `${e.party} · ${dmy(e.date)}`, body: <div className="rcv"><div><span>Amount</span><b>{inr2f(-Number(e.amt))}</b></div><div><span>Mode</span><b>{e.mode || '—'}</b></div><div><span>Reference</span><b className="mono">{e.ref || '—'}</b></div><div><span>Paid from</span><b>{acct.name}</b></div></div> });
    }
    if (e.src !== 'bank_entry') return;
    const t = await api<EntryDoc>(`/banking/entries/${e.sourceId}`);
    const two = t.kind === 'transfer' || t.kind === 'deposit' || t.kind === 'withdraw';
    // deliberate difference: hand entries are cancelled, never deleted
    setModal({
      title: `${e.kind} · ${t.number}`, sub: dmy(t.date), ok: 'Cancel entry', danger: true,
      body: <div className="rcv"><div><span>Amount</span><b>{inr2f(t.amount)}</b></div>{two ? <div><span>From → to</span><b>{name(t.accountId)} → {name(t.toAccountId)}</b></div> : <div><span>Account</span><b>{name(t.accountId)}</b></div>}<div><span>Reference</span><b className="mono">{t.reference || '—'}</b></div><div><span>Note</span><b>{t.note || '—'}</b></div></div>,
      onOk: async () => {
        try {
          if (!(await withPasscode(qc, cancelAsk(t.number, 'entry'), (h) => api(`/banking/entries/${t.id}/cancel`, { method: 'POST', body: {}, headers: h })))) return;
          setModal(null);
          await Promise.all(BK_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
          showToast(`${t.number} cancelled`);
        } catch (err) { showToast(err instanceof ApiError ? err.message : 'Could not cancel the entry.'); }
      },
    });
  };
  const history = (e: BookEntry) => {
    const t = bookHistory(e);
    if (t) void openHistory(t, e.sourceId, setModal, showToast);
  };
  return { modal, setModal, open, edit, history };
}

/* ───────── Bank accounts ───────── */
export function BankAccountsPage() {
  useFitTables();
  const accts = useAccounts();
  const [params] = useSearchParams();
  const [sel, setSel] = useState<string | null>(params.get('acct'));
  const [move, setMove] = useState<Move | null>(null);
  const [edit, setEdit] = useState<{ id: string | null } | null>(null);
  const [per, setPer] = useState<BkPer>('all');
  const B = (accts.data ?? []).filter((a) => a.kind === 'bank');
  const cur = B.find((a) => a.id === sel) ?? B[0];
  const book = useBook(cur?.id);
  const ev = useEntryView(accts.data ?? []);
  if (!accts.data || (cur && book.data?.id !== cur.id)) return <section id="vBks"></section>;
  const tot = B.reduce((s, a) => s + Number(a.balance), 0);
  return (
    <section id="vBks">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Bank accounts</h1><span className="pttot" id="bkTot">{`${B.length} account${B.length === 1 ? '' : 's'} · total ${inr(tot.toFixed(2))}`}</span><div className="sp"></div><button className="btn" id="bkMove" onClick={() => setMove({ kind: 'transfer', acct: cur?.id })}><Icon name="swap" />Transfer money</button><button className="btn p" id="bkAdd" onClick={() => setEdit({ id: null })}><RawIcon d={PLUS} />Add bank account</button></div>
      <div className="bkcards" id="bkCards">{B.map((a) => {
        const L = a.id === cur?.id ? book.data!.entries : [];
        const M = L.filter((e) => inPeriod(e.date, 'oct'));
        const mi = M.filter((e) => Number(e.amt) > 0).reduce((s, e) => s + Number(e.amt), 0), mo = M.filter((e) => Number(e.amt) < 0).reduce((s, e) => s - Number(e.amt), 0);
        return <BankCard key={a.id} a={a} on={a.id === cur?.id} col={bkCol(a, B)} mi={a.id === cur?.id ? mi : null} mo={mo} onPick={() => { setSel(a.id); setPer('all'); }} />;
      })}<button type="button" className="bkc add" id="bkAdd2" onClick={() => setEdit({ id: null })}><RawIcon d={PLUS} /><b>Add bank account</b><small>Current, savings, OD or CC</small></button></div>
      {cur && book.data ? <LedgerCard key={cur.id} p="bk" a={cur} book={book.data} per={per} setPer={setPer} onEntry={(e) => void ev.open(e, cur)} onEdit={(e) => void ev.edit(e).then((t) => t && setMove({ kind: t.kind, edit: t }))} onHistory={ev.history} head={(r: ReturnType<typeof ledger>) => <>
        <div><h2>{cur.name} <small className="mu">{cur.sub}</small></h2><small className="mu mono">{[cur.accountNo && 'A/c ' + cur.accountNo, cur.ifsc && 'IFSC ' + cur.ifsc, cur.branch].filter(Boolean).join(' · ')}</small></div>
        <div className="bkhs"><span>Opening <b>{inr2f(r.openB)}</b></span><span>In <b className="pos">{inr2f(r.tin)}</b></span><span>Out <b className="neg">{inr2f(r.tout)}</b></span><span>Closing <b>{inr2f(r.close)}</b></span></div>
        <div className="bkha"><button className="btn sm" data-bkin={cur.id} onClick={() => setMove({ kind: 'in', acct: cur.id })}><RawIcon d={PLUS} />Add / take out</button><button className="btn sm" data-bkedit={cur.id} onClick={() => setEdit({ id: cur.id })}><Icon name="edit" />Edit</button></div></>} />
        : <div className="card ptxc bkled"><div className="bkhd" id="bkHd"></div><div className="tw" style={{ margin: 0 }}><table className="ptt2 bkt"><tbody id="bkRows"><tr><td colSpan={7} className="ptempty">Add your first bank account to start a bank book.</td></tr></tbody></table></div></div>}
      <MoveMoney open={move} accounts={accts.data} onClose={() => setMove(null)} />
      <AccountDialog open={edit} accounts={accts.data} onClose={() => setEdit(null)} onSaved={(id) => setSel(id)} />
      <SlModal m={ev.modal} onClose={() => ev.setModal(null)} />
    </section>
  );
}

/** One bank's card; "this month" money in and out comes from that bank's book. */
function BankCard({ a, on, col, mi, mo, onPick }: { a: Account; on: boolean; col: string; mi: number | null; mo: number; onPick: () => void }) {
  const own = useBook(on ? null : a.id);
  let inM = mi ?? 0, outM = mo;
  if (mi === null && own.data) {
    const M = own.data.entries.filter((e) => inPeriod(e.date, 'oct'));
    inM = M.filter((e) => Number(e.amt) > 0).reduce((s, e) => s + Number(e.amt), 0);
    outM = M.filter((e) => Number(e.amt) < 0).reduce((s, e) => s - Number(e.amt), 0);
  }
  const bal = Number(a.balance);
  return (
    <button type="button" className={`bkc${on ? ' on' : ''}`} data-bkacct={a.id} aria-pressed={on} onClick={onPick}><span className="bkn"><span className="bkico" style={tint(col)}><Icon name="bank" /></span><span><b>{a.name}{a.isDefault ? <> <span className="bkdef" title="UPI, card and bank transfers go here">UPI default</span></> : null}</b><small>{a.sub}{a.accountNo ? ' · ' + bkMask(a.accountNo) : ''}</small></span></span>
      <span className={`bkb ${bal < 0 ? 'neg' : ''}`}>{inr2f(bal)}</span><span className="bkio"><span>This month in <b className="pos">{inr(inM.toFixed(2))}</b></span><span>out <b className="neg">{inr(outM.toFixed(2))}</b></span></span></button>
  );
}

/* ───────── Cash in hand ───────── */
export function CashPage() {
  useFitTables();
  const accts = useAccounts();
  const cash = (accts.data ?? []).find((a) => a.kind === 'cash');
  const book = useBook(cash?.id);
  const [move, setMove] = useState<Move | null>(null);
  const [edit, setEdit] = useState<{ id: string | null } | null>(null);
  const [count, setCount] = useState(false);
  const ev = useEntryView(accts.data ?? []);
  const [per, setPer] = useState<BkPer>('all');
  if (!accts.data || !cash || book.data?.id !== cash.id) return <section id="vCash"></section>;
  const r = ledger(book.data, per);
  const c = Number(cash.balance);
  return (
    <section id="vCash">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Cash in hand</h1><span className="pttot">Cash book of the shop counter</span><div className="sp"></div><button className="btn" id="caCount" onClick={() => setCount(true)}><Icon name="check" />Count cash</button><button className="btn" id="caDep" onClick={() => setMove({ kind: 'deposit' })}><Icon name="bank" />Deposit to bank</button><button className="btn p" id="caMove" onClick={() => setMove({ kind: 'out', acct: cash.id, cat: 'Shop expense' })}><RawIcon d={PLUS} />Add / take out cash</button></div>
      <div className="sumrow" id="caSum"><div><small>Opening{r.start ? ' on ' + dmy(r.start) : ''}</small><b>{inr(r.openB.toFixed(2))}</b></div><div><small>Cash in</small><b className="pos">{inr(r.tin.toFixed(2))}</b></div><div><small>Cash out</small><b className="neg">{inr(r.tout.toFixed(2))}</b></div><div><small>Cash in hand now</small><b className={c < 0 ? 'neg' : ''}>{inr(c.toFixed(2))}</b></div></div>
      <LedgerCard p="ca" a={cash} book={book.data} per={per} setPer={setPer} onEntry={(e) => void ev.open(e, cash)} onEdit={(e) => void ev.edit(e).then((t) => t && setMove({ kind: t.kind, edit: t }))} onHistory={ev.history} head={() => <><div><h2>Cash book</h2><small className="mu">Cash sales, cash receipts and cash payments land here automatically.</small></div><div className="bkha"><button className="btn sm" data-bkedit="cash" onClick={() => setEdit({ id: cash.id })}><Icon name="edit" />Opening balance</button></div></>} />
      <MoveMoney open={move} accounts={accts.data} onClose={() => setMove(null)} />
      <AccountDialog open={edit} accounts={accts.data} onClose={() => setEdit(null)} onSaved={() => undefined} />
      {/* one small window at a time, like the prototype's single #slm */}
      {count ? <CountCash open={count} book={c} onClose={() => setCount(false)} /> : <SlModal m={ev.modal} onClose={() => ev.setModal(null)} />}
    </section>
  );
}
/* ───────── Move money (prototype bmm) ───────── */
const BM_T: Record<Move['kind'], string> = { transfer: 'Transfer between banks', deposit: 'Deposit cash in bank', withdraw: 'Withdraw cash from bank', in: 'Add money', out: 'Take out money' };
const BM_H: Record<Move['kind'], string> = {
  transfer: 'Moves money between two of your bank accounts. Your total doesn’t change.', deposit: 'Cash in hand goes down and the bank balance goes up.', withdraw: 'Bank balance goes down and cash in hand goes up.',
  in: 'For money that isn’t a customer payment — interest, owner’s capital, a loan.', out: 'For money that isn’t a supplier payment — bank charges, shop expenses, drawings.',
};

export function MoveMoney({ open, accounts, onClose }: { open: Move | null; accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState<Move['kind']>('transfer');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [acct, setAcct] = useState('');
  const [cat, setCat] = useState('');
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState(today());
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useOpenFocus(!!open, ref);
  useEscape(!!open, onClose);
  const cash = accounts.find((a) => a.kind === 'cash');
  const banks = accounts.filter((a) => a.kind === 'bank');
  const defBank = (banks.find((b) => b.isDefault) ?? banks[0] ?? cash)?.id ?? '';
  const kind = (nk: Move['kind'], o: Move = { kind: nk }) => {
    setK(nk);
    const a = o.acct && o.acct !== cash?.id ? o.acct : defBank;
    if (nk === 'deposit') { setFrom(cash?.id ?? ''); setTo(a); }
    else if (nk === 'withdraw') { setFrom(a); setTo(cash?.id ?? ''); }
    else if (nk === 'transfer') { setFrom(a); setTo(banks.find((b) => b.id !== a)?.id ?? ''); }
    else setCat(o.cat ?? BANK_CATEGORIES[nk][0]);
  };
  const x = open?.edit;
  useEffect(() => {
    if (!open) return;
    setAmt(''); setRefNo(''); setNote(''); setDate(today()); setErr('');
    setAcct(open.acct ?? accounts[0]?.id ?? '');
    kind(open.kind, open);
    // editing: the saved entry fills the window (same number, passcode when it is on)
    if (x) {
      setAmt(String(Number(x.amount))); setRefNo(x.reference); setNote(x.note); setDate(x.date);
      if (x.toAccountId) { setFrom(x.accountId); setTo(x.toAccountId); } else { setAcct(x.accountId); setCat(x.category); }
    }
    setTimeout(() => (document.getElementById('bmmAmt') as HTMLElement | null)?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const two = k === 'transfer' || k === 'deposit' || k === 'withdraw';
  const opt = (a: Account, off: boolean) => <option value={a.id} key={a.id} disabled={off}>{a.name}{a.accountNo ? ' · ' + bkMask(a.accountNo) : ''}</option>;
  const save = async () => {
    const n = Number(amt.replace(/[^\d.]/g, '')) || 0;
    if (!(n > 0)) { setErr('Enter the amount.'); return document.getElementById('bmmAmt')?.focus(); }
    if (two && (!from || !to || from === to)) return setErr('Choose two different accounts.');
    setBusy(true);
    try {
      const body = { kind: k, date, amount: String(n), ...(two ? { fromId: from, toId: to } : { accountId: acct, category: cat }), reference: refNo.trim(), note: note.trim(), ...(x && { number: x.number }) };
      const call = (h?: Record<string, string>) => api<{ number: string }>(x ? `/banking/entries/${x.id}` : '/banking/entries', { method: x ? 'PUT' : 'POST', body, headers: h });
      const res = x ? await withPasscode(qc, editAsk(x.number), call) : { value: await call() };
      if (!res) return;
      const r = res.value;
      onClose();
      await Promise.all(ENTRY_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));
      const nm = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
      showToast(`${r.number} saved · ${inr2f(n)} ${two ? nm(from) + ' → ' + nm(to) : (k === 'in' ? 'added to ' : 'taken out of ') + nm(acct)}`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="ov c" id="bmm" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'bmm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bmmT" style={{ width: 'min(580px,100%)' }}>
        <div className="dh"><h3 id="bmmT" style={{ margin: 0, fontSize: ui.fs(18) }}>{x ? `Edit ${x.number}` : BM_T[k]}</h3><button className="ib" type="button" id="bmmClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="seg2 bmseg" id="bmmK" role="group" aria-label="Type">{(['transfer', 'deposit', 'withdraw', 'in', 'out'] as const).map((x) => <button data-mk={x} key={x} className={k === x ? 'on' : undefined} aria-pressed={k === x} onClick={() => kind(x, { kind: x, acct })}>{{ transfer: 'Bank to bank', deposit: 'Deposit cash', withdraw: 'Withdraw cash', in: 'Add money', out: 'Take out money' }[x]}</button>)}</div>
        <div className="two" id="bmmFT" style={two ? undefined : { display: 'none' }}><label className="fl" htmlFor="bmmFrom">From<select className="fi" id="bmmFrom" value={from} onChange={(e) => setFrom(e.target.value)}>{accounts.map((a) => opt(a, k === 'deposit' ? a.kind !== 'cash' : a.kind === 'cash'))}</select></label>
          <label className="fl" htmlFor="bmmTo">To<select className="fi" id="bmmTo" value={to} onChange={(e) => setTo(e.target.value)}>{accounts.map((a) => opt(a, k === 'withdraw' ? a.kind !== 'cash' : a.kind === 'cash'))}</select></label></div>
        <div className="two" id="bmmAC" style={two ? { display: 'none' } : undefined}><label className="fl" htmlFor="bmmAcct">Account<select className="fi" id="bmmAcct" value={acct} onChange={(e) => setAcct(e.target.value)}>{accounts.map((a) => opt(a, false))}</select></label>
          <label className="fl" htmlFor="bmmCat">What for<select className="fi" id="bmmCat" value={cat} onChange={(e) => setCat(e.target.value)}>{two ? null : BANK_CATEGORIES[k as 'in' | 'out'].map((c) => <option key={c}>{c}</option>)}</select></label></div>
        <div className="two"><label className="fl" htmlFor="bmmAmt">Amount<input className="fi n" id="bmmAmt" inputMode="decimal" placeholder="0" autoComplete="off" value={amt} onChange={(e) => setAmt(e.target.value)} /></label><label className="fl" htmlFor="bmmDate">Date<input className="fi" type="date" id="bmmDate" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        <div className="two"><label className="fl" htmlFor="bmmRef">Reference<input className="fi" id="bmmRef" placeholder="UTR, slip or cheque no." autoComplete="off" value={refNo} onChange={(e) => setRefNo(e.target.value)} /></label><label className="fl" htmlFor="bmmNote">Note<input className="fi" id="bmmNote" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} /></label></div>
        <p className="hint" id="bmmHint" style={{ margin: ui.sp('2px 0 0') }}>{BM_H[k]}</p><div className="msg bad" id="bmmErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end', marginTop: ui.sp(12) }}><button className="btn" type="button" id="bmmCancel" onClick={onClose}>Cancel</button><button className="btn p" type="button" id="bmmSave" disabled={busy} onClick={() => void save()}>Save</button></div>
      </div>
    </div>
  );
}

/* ───────── Add / edit an account (prototype bam) ───────── */
function AccountDialog({ open, accounts, onClose, onSaved }: { open: { id: string | null } | null; accounts: Account[]; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const a = open?.id ? accounts.find((x) => x.id === open.id) ?? null : null;
  const cash = a?.kind === 'cash';
  const [f, setF] = useState({ name: '', sub: 'Current account', accountNo: '', ifsc: '', branch: '', open: '', od: today(), def: false });
  const [err, setErr] = useState('');
  const [sure, setSure] = useState(false);
  useOpenFocus(!!open, ref);
  useEscape(!!open, onClose);
  useEffect(() => {
    if (!open) return;
    setF({ name: a?.name && !cash ? a.name : '', sub: a?.sub && (BANK_TYPES as readonly string[]).includes(a.sub) ? a.sub : 'Current account', accountNo: a?.accountNo ?? '', ifsc: a?.ifsc ?? '', branch: a?.branch ?? '',
      open: a && Number(a.openingBalance) ? String(Number(a.openingBalance)) : '', od: a?.openingDate ?? today(), def: a ? a.isDefault : !accounts.some((x) => x.kind === 'bank') });
    setErr(''); setSure(false);
    setTimeout(() => (document.getElementById(cash ? 'bamOpen' : 'bamName') as HTMLElement | null)?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const refresh = () => Promise.all(BK_KEYS.map((x) => qc.invalidateQueries({ queryKey: [x] })));
  const save = async () => {
    const body = { name: f.name.trim(), sub: f.sub, accountNo: f.accountNo.replace(/\s/g, ''), ifsc: f.ifsc.trim().toUpperCase(), branch: f.branch.trim(), openingBalance: f.open.replace(/[^\d.-]/g, '') || '0', openingDate: f.od || today(), isDefault: f.def };
    try {
      const r = await api<{ id: string; name: string }>(a ? `/banking/accounts/${a.id}` : '/banking/accounts', { method: a ? 'PUT' : 'POST', body });
      onClose();
      await refresh();
      if (!cash) onSaved(r.id);
      showToast(a ? `${r.name} updated` : `${r.name} added`);
    } catch (e) {
      const m = e instanceof ApiError ? e.message : 'Could not save.';
      setErr(m);
      const field = e instanceof ApiError ? (e as ApiError & { field?: string }).field : undefined;
      document.getElementById(field === 'accountNo' ? 'bamNo' : field === 'ifsc' ? 'bamIfsc' : 'bamName')?.focus();
    }
  };
  const del = async () => {
    if (!a) return;
    if (!sure) { setSure(true); setTimeout(() => setSure(false), 2500); return; }
    try { await api(`/banking/accounts/${a.id}/remove`, { method: 'POST', body: {} }); onClose(); await refresh(); showToast(`${a.name} deleted`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not delete the account.'); }
  };
  return (
    <div className="ov c" id="bam" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'bam') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bamT" style={{ width: 'min(560px,100%)' }}>
        <div className="dh"><h3 id="bamT" style={{ margin: 0, fontSize: ui.fs(18) }}>{cash ? 'Cash in hand' : a ? 'Edit bank account' : 'Add bank account'}</h3><button className="ib" type="button" id="bamClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div id="bamBank" hidden={cash}><div className="two" style={{ marginTop: ui.sp(14) }}><label className="fl" htmlFor="bamName">Bank name<input className="fi" id="bamName" placeholder="e.g. ICICI Bank" autoComplete="off" value={f.name} onChange={set('name')} /></label><label className="fl" htmlFor="bamType">Account type<select className="fi" id="bamType" value={f.sub} onChange={set('sub')}>{BANK_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label></div>
          <div className="two"><label className="fl" htmlFor="bamNo">Account number<input className="fi mono" id="bamNo" inputMode="numeric" autoComplete="off" value={f.accountNo} onChange={set('accountNo')} /></label><label className="fl" htmlFor="bamIfsc">IFSC<input className="fi mono" id="bamIfsc" autoComplete="off" placeholder="ABCD0123456" style={{ textTransform: 'uppercase' }} value={f.ifsc} onChange={set('ifsc')} /></label></div>
          <label className="fl" htmlFor="bamBr">Branch<input className="fi" id="bamBr" autoComplete="off" value={f.branch} onChange={set('branch')} /></label></div>
        <div className="two" id="bamOpenW"><label className="fl" htmlFor="bamOpen">Opening balance<input className="fi n" id="bamOpen" inputMode="decimal" placeholder="0" autoComplete="off" value={f.open} onChange={set('open')} /></label><label className="fl" htmlFor="bamOd">As on<input className="fi" type="date" id="bamOd" value={f.od} onChange={set('od')} /></label></div>
        <label className="cb2" id="bamDefW" style={{ margin: ui.sp('4px 0 0') }} hidden={cash}><input type="checkbox" id="bamDef" checked={f.def} onChange={set('def')} /> Payments by UPI, card and bank transfer go to this account</label>
        <div className="msg bad" id="bamErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: ui.sp(10), marginTop: ui.sp(14) }}><button className="btn dz" type="button" id="bamDel" hidden={!a || cash} style={!a || cash ? { display: 'none' } : undefined} disabled={!!a?.used} title={a?.used ? 'This account has entries. Move them first.' : ''} onClick={() => void del()}>{sure ? 'Click again to delete' : 'Delete account'}</button><span style={{ flex: 1 }}></span><button className="btn" type="button" id="bamCancel" onClick={onClose}>Cancel</button><button className="btn p" type="button" id="bamSave" onClick={() => void save()}>Save</button></div>
      </div>
    </div>
  );
}

/* ───────── Count cash (prototype cashCount) ───────── */
function CountCash({ open, book, onClose }: { open: boolean; book: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [v, setV] = useState('');
  useEffect(() => { if (open) { setV(''); setTimeout(() => (document.getElementById('ccAmt') as HTMLElement | null)?.focus(), 30); } }, [open]);
  const d = Math.round(((Number(v) || 0) - book) * 100) / 100;
  const ok = async () => {
    if (v === '') return document.getElementById('ccAmt')?.focus();
    if (Math.abs(d) < 0.01) { onClose(); return showToast('Cash matches the books'); }
    try {
      await api('/banking/count-cash', { method: 'POST', body: { counted: v, date: today() } });
      onClose();
      await Promise.all(BK_KEYS.map((x) => qc.invalidateQueries({ queryKey: [x] })));
      showToast(`Cash ${d > 0 ? 'excess' : 'short'} ${inr2f(Math.abs(d))} recorded`);
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not save the count.'); }
  };
  return <SlModal m={open ? {
    title: 'Count cash', sub: `Cash in books: ${inr2f(book)}`, ok: 'Save difference', onOk: () => void ok(),
    body: <><label className="fl" htmlFor="ccAmt">Cash actually in the counter<input className="fi n" id="ccAmt" inputMode="decimal" placeholder={String(book)} autoComplete="off" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} /></label>
      <p className="hint" id="ccH" style={{ margin: ui.sp('4px 0 0') }}>{v === '' ? 'Count the notes and coins and enter the total. Any difference is saved as a cash adjustment.' : Math.abs(d) < 0.01 ? <b className="pos">Matches the books.</b> : <><b className={d > 0 ? 'pos' : 'neg'}>{d > 0 ? 'Excess' : 'Short'} {inr2f(Math.abs(d))}</b> — saved as a cash adjustment.</>}</p></>,
  } : null} onClose={onClose} />;
}
