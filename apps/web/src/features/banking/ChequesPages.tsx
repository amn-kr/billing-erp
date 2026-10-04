/**
 * Cheques (#vChq, renderChq + the bcm window) and Reconciliation (#vRec, renderRec) — the
 * prototype's last two Banking & cash pages.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { daysBetween } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { useFitTables } from '../../lib/useFitTables';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { useEscape } from '../../lib/useEscape';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { inPeriod } from '../sales/model';
import { MoveMoney, type Move } from './BankingPages';
import { BK_KEYS, bkMask, useAccounts, useBook, type Account } from './model';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';

export interface Cheque {
  id: string; dir: 'in' | 'out'; number: string; date: string; ref: string; party: string; partyId: string | null; amount: string; against: string;
  status: 'pending' | 'cleared' | 'bounced'; statusDate: string | null; accountId: string | null; charges: string; note: string;
}
const useCheques = () => useQuery({ queryKey: ['cheques'], queryFn: () => api<Cheque[]>('/banking/cheques') });
const CQ_KEYS = ['cheques', 'sales', 'purchases', ...BK_KEYS];
const S: Record<Cheque['status'], { t: string; c: string }> = { pending: { t: 'Pending', c: 'b' }, cleared: { t: 'Cleared', c: 'g' }, bounced: { t: 'Bounced', c: 'r' } };

/* ───────── Cheques ───────── */
export function ChequesPage() {
  useFitTables();
  const list = useCheques();
  const accts = useAccounts();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [st, setSt] = useState('pending');
  const [q, setQ] = useState('');
  const [bcm, setBcm] = useState<{ c: Cheque; act: 'ok' | 'bn' } | null>(null);
  if (!list.data || !accts.data) return <section id="vChq"></section>;
  const A = list.data;
  const sum = (f: (c: Cheque) => boolean) => A.filter(f).reduce((s, c) => s + Number(c.amount), 0);
  const cnt = (f: (c: Cheque) => boolean) => A.filter(f).length;
  const pi = (c: Cheque) => c.dir === 'in' && c.status === 'pending', po = (c: Cheque) => c.dir === 'out' && c.status === 'pending';
  const cl = (c: Cheque) => c.status === 'cleared' && !!c.statusDate && inPeriod(c.statusDate, 'oct'), bn = (c: Cheque) => c.status === 'bounced';
  const s = q.toLowerCase();
  const L = A.filter((c) => c.dir === dir && (st === 'all' || c.status === st) && (!s || [c.ref, c.party, c.number, c.against].join(' ').toLowerCase().includes(s)));
  const t = today();
  const name = (id: string | null) => accts.data.find((a) => a.id === id)?.name ?? '';
  const undo = async (c: Cheque) => {
    try {
      await api(`/banking/cheques/${c.id}/undo`, { method: 'POST', body: {} });
      await Promise.all(CQ_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`${c.ref || c.number} is pending again`);
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not undo.'); }
  };
  return (
    <section id="vChq">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Cheques</h1><span className="pttot">Track cheques until they clear</span></div>
      <div className="sumrow" id="cqSum"><div><small>To deposit · {cnt(pi)} cheque{cnt(pi) === 1 ? '' : 's'}</small><b className="pos">{inr(sum(pi).toFixed(2))}</b></div><div><small>Issued, not yet debited · {cnt(po)}</small><b className="neg">{inr(sum(po).toFixed(2))}</b></div><div><small>Cleared this month · {cnt(cl)}</small><b>{inr(sum(cl).toFixed(2))}</b></div><div><small>Bounced · {cnt(bn)}</small><b className={cnt(bn) ? 'neg' : ''}>{inr(sum(bn).toFixed(2))}</b></div></div>
      <div className="card ptxc"><div className="ptfil" style={{ padding: '12px 16px', alignItems: 'center' }}><div className="seg2" id="cqDir"><button data-dir="in" className={dir === 'in' ? 'on' : ''} onClick={() => setDir('in')}>Received from customers</button><button data-dir="out" className={dir === 'out' ? 'on' : ''} onClick={() => setDir('out')}>Issued to suppliers</button></div>
        <select className="fi" id="cqSt" aria-label="Status" style={{ width: 'auto' }} value={st} onChange={(e) => setSt(e.target.value)}><option value="pending">Pending</option><option value="cleared">Cleared</option><option value="bounced">Bounced</option><option value="all">All cheques</option></select>
        <label className="search" htmlFor="cqQ" style={{ maxWidth: 260, height: 36 }}><RawIcon d={SEARCH} /><input id="cqQ" placeholder="Search cheque no. or party" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Cheque no.</th><th>Party</th><th>Against</th><th className="n">Amount</th><th>Status</th><th className="n"><span className="vh">Actions</span></th></tr></thead>
          <tbody id="cqRows">{L.length ? L.map((c) => {
            const age = daysBetween(c.date, t);
            return (
              <tr key={c.id}><td>{dmy(c.date)}</td><td className="mono">{c.ref || '—'}<small className="mu" style={{ display: 'block' }}>{c.number}</small></td><td><b style={{ fontWeight: 600 }}>{c.party}</b></td><td className="mono mu">{c.against || '—'}</td><td className="n"><b>{inr2f(c.amount)}</b></td>
                <td><span className={`stt ${S[c.status].c}`}>{S[c.status].t}</span><small className="mu" style={{ display: 'block' }}>{c.status === 'pending' ? (age > 0 ? `${age} day${age > 1 ? 's' : ''} old` : 'Today') : c.status === 'cleared' ? `${dmy(c.statusDate)}${c.accountId ? ' · ' + name(c.accountId) : ''}` : `${dmy(c.statusDate)}${c.note ? ' · ' + c.note : ''}`}</small></td>
                <td className="n" style={{ whiteSpace: 'nowrap' }}>{c.status === 'pending' ? <><button className="btn p sm" data-cqok={c.id} onClick={() => setBcm({ c, act: 'ok' })}>{c.dir === 'in' ? 'Deposited' : 'Cleared'}</button> <button className="btn sm" data-cqbn={c.id} onClick={() => setBcm({ c, act: 'bn' })}>Bounced</button></> : <button className="btn sm" data-cqundo={c.id} onClick={() => void undo(c)}>Undo</button>}</td></tr>
            );
          }) : <tr><td colSpan={7}><div className="ptempty pue"><b>No {st === 'all' ? '' : st + ' '}cheques</b><span>{dir === 'in' ? 'Cheques you receive in Payments received show up here until they clear.' : 'Cheques you give in Payments made show up here until the bank debits them.'}</span></div></td></tr>}</tbody></table></div></div>
      <ChequeDialog open={bcm} accounts={accts.data} onClose={() => setBcm(null)} />
    </section>
  );
}

/** Deposited / cleared or bounced (prototype bcm). */
function ChequeDialog({ open, accounts, onClose }: { open: { c: Cheque; act: 'ok' | 'bn' } | null; accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const banks = accounts.filter((a) => a.kind === 'bank');
  const defBank = (banks.find((b) => b.isDefault) ?? banks[0])?.id ?? '';
  const [acct, setAcct] = useState('');
  const [date, setDate] = useState(today());
  const [chg, setChg] = useState('');
  const [note, setNote] = useState('');
  useOpenFocus(!!open, ref);
  useEscape(!!open, onClose);
  useEffect(() => { if (open) { setAcct(open.c.accountId ?? defBank); setDate(today()); setChg(''); setNote(''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const c = open?.c, ok = open?.act === 'ok', inn = c?.dir === 'in';
  const save = async () => {
    if (!c) return;
    if (!acct || !banks.some((b) => b.id === acct)) { showToast('Add a bank account first — Banking › Bank accounts'); return; }
    try {
      if (ok) await api(`/banking/cheques/${c.id}/clear`, { method: 'POST', body: { accountId: acct, date } });
      else await api(`/banking/cheques/${c.id}/bounce`, { method: 'POST', body: { accountId: acct, date, charges: chg, note: note.trim() } });
      onClose();
      await Promise.all(CQ_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(ok ? `${c.ref || c.number} · ${inr2f(c.amount)} ${inn ? 'added to' : 'paid from'} ${accounts.find((a) => a.id === acct)?.name ?? ''}` : `${c.ref || c.number} marked bounced · ${inr2f(c.amount)} back on ${c.party}’s account`);
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not save.'); }
  };
  return (
    <div className="ov c" id="bcm" hidden={!open} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'bcm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bcmT" style={{ width: 'min(480px,100%)' }}>
        <div className="dh"><div><h3 id="bcmT" style={{ margin: 0, fontSize: 18 }}>{c ? (ok ? (inn ? 'Cheque deposited' : 'Cheque cleared') : 'Cheque bounced') : ''}</h3><small className="mu" id="bcmSub">{c ? `${c.ref || c.number} · ${c.party} · ${inr2f(c.amount)}` : ''}</small></div><button className="ib" type="button" id="bcmClose" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="two" style={{ marginTop: 14 }}><label className="fl" htmlFor="bcmAcct" id="bcmAcctL">{ok ? (inn ? 'Deposited in' : 'Paid from') : 'Bank account'}<select className="fi" id="bcmAcct" value={acct} onChange={(e) => setAcct(e.target.value)}>{banks.map((a) => <option value={a.id} key={a.id}>{a.name}{a.accountNo ? ' · ' + bkMask(a.accountNo) : ''}</option>)}</select></label>
          <label className="fl" htmlFor="bcmDate">Date<input className="fi" type="date" id="bcmDate" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        <div id="bcmBn" hidden={ok}><label className="fl" htmlFor="bcmChg">Bank charges for the bounce<input className="fi n" id="bcmChg" inputMode="decimal" placeholder="0" autoComplete="off" value={chg} onChange={(e) => setChg(e.target.value)} /></label><label className="fl" htmlFor="bcmNote">Reason<input className="fi" id="bcmNote" placeholder="e.g. Insufficient funds" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="hint" id="bcmBnH" style={{ margin: 0 }}>{c ? (inn ? `${inr2f(c.amount)} goes back on ${c.party}’s account as unpaid.` : `You will owe ${c.party} ${inr2f(c.amount)} again.`) : ''}</p></div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn" type="button" id="bcmCancel" onClick={onClose}>Cancel</button><button className={`btn p${ok ? '' : ' dz'}`} type="button" id="bcmSave" onClick={() => void save()}>{ok ? 'Mark ' + (inn ? 'deposited' : 'cleared') : 'Mark bounced'}</button></div>
      </div>
    </div>
  );
}

/* ───────── Reconciliation ───────── */
interface Rec { asOf: string; statement: string | null; ticked: string[] }

export function ReconciliationPage() {
  useFitTables();
  const accts = useAccounts();
  const qc = useQueryClient();
  const B = (accts.data ?? []).filter((a) => a.kind === 'bank');
  const [sel, setSel] = useState<string | null>(null);
  const id = (B.find((b) => b.id === sel) ?? B[0])?.id ?? null;
  const book = useBook(id);
  const rec = useQuery({ queryKey: ['reconciliation', id], queryFn: () => api<Rec>(`/banking/accounts/${id}/reconciliation`), enabled: !!id });
  const [st, setSt] = useState<Rec | null>(null);
  const [stmtTxt, setStmtTxt] = useState('');
  const [show, setShow] = useState<'all' | 'open'>('all');
  const [move, setMove] = useState<Move | null>(null);
  useEffect(() => { if (rec.data) { setSt(rec.data); setStmtTxt(rec.data.statement === null ? '' : String(Number(rec.data.statement))); } }, [rec.data]);
  if (!accts.data) return <section id="vRec"></section>;
  const save = (n: Rec) => { setSt(n); qc.setQueryData(['reconciliation', id], n); void api(`/banking/accounts/${id}/reconciliation`, { method: 'PUT', body: n }); };
  const a = B.find((b) => b.id === id);
  const ready = a && book.data?.id === id && st && rec.data;
  const U = ready ? book.data!.entries.filter((e) => e.date <= st!.asOf) : [];
  const tick = new Set(st?.ticked ?? []);
  const bookBal = U.length ? Number(U[U.length - 1]!.run) : Number(a?.openingBalance ?? 0);
  const cleared = Math.round((Number(a?.openingBalance ?? 0) + U.filter((e) => tick.has(e.key)).reduce((s, e) => s + Number(e.amt), 0)) * 100) / 100;
  const stmt = st?.statement === null || st?.statement === undefined ? null : Number(st.statement);
  const diff = stmt === null ? null : Math.round((stmt - cleared) * 100) / 100;
  const nt = U.filter((e) => !tick.has(e.key));
  const R = U.slice().reverse().filter((e) => show === 'all' || !tick.has(e.key));
  return (
    <section id="vRec">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Reconciliation</h1><span className="pttot">Match your books with the bank statement</span></div>
      <div className="card bkrbar"><label className="fl" htmlFor="bkrAcct">Bank account<select className="fi" id="bkrAcct" value={id ?? ''} onChange={(e) => setSel(e.target.value)}>{B.map((b) => <option value={b.id} key={b.id}>{b.name}{b.accountNo ? ' · ' + bkMask(b.accountNo) : ''}</option>)}</select></label>
        <label className="fl" htmlFor="bkrAsOf">Statement date<input className="fi" type="date" id="bkrAsOf" value={st?.asOf ?? ''} onChange={(e) => st && save({ ...st, asOf: e.target.value || st.asOf })} /></label>
        <label className="fl" htmlFor="bkrStmt">Closing balance on statement<input className="fi n" id="bkrStmt" inputMode="decimal" placeholder="Enter from bank statement" autoComplete="off" value={stmtTxt} onChange={(e) => { const v = e.target.value.replace(/[^\d.-]/g, ''); setStmtTxt(v); if (st) save({ ...st, statement: v === '' || isNaN(Number(v)) ? null : v }); }} /></label></div>
      {!B.length ? <div className="card ptxc"><div className="tw" style={{ margin: 0 }}><table className="ptt2 bkt"><tbody id="bkrRows"><tr><td colSpan={6} className="ptempty">Add a bank account first.</td></tr></tbody></table></div></div> : ready ? <>
        <div className="sumrow" id="bkrSum"><div><small>Balance in books</small><b>{inr2f(bookBal)}</b></div><div><small>Ticked entries balance</small><b>{inr2f(cleared)}</b></div><div><small>Statement balance</small><b>{stmt === null ? '—' : inr2f(stmt)}</b></div><div className={diff === null ? '' : Math.abs(diff) < 0.01 ? 'bkok' : 'bkbad'}><small>Difference</small><b>{diff === null ? '—' : inr2f(diff)}</b></div></div>
        <div id="bkrMsg">{diff === null ? <div className="bkmsg">Enter the closing balance from your bank statement to start.</div> : Math.abs(diff) < 0.01
          ? <div className="bkmsg ok"><Icon name="check" /><span><b>Reconciled.</b> Your books match the {a!.name} statement up to {dmy(st!.asOf)}.{nt.length ? ` ${nt.length} entr${nt.length > 1 ? 'ies are' : 'y is'} not on the statement yet — usually cheques or deposits in transit.` : ''}</span></div>
          : <div className="bkmsg bad"><Icon name="alert" /><span><b>{inr2f(Math.abs(diff))} {diff > 0 ? 'more in the bank than ticked' : 'less in the bank than ticked'}.</b> Tick the entries that appear on the statement{diff < 0 ? ' or untick ones that don’t' : ''}. If something is on the statement but not in your books (bank charges, interest), add it with <button type="button" className="lnk" id="bkrAddM" onClick={() => setMove({ kind: 'out', acct: id!, cat: 'Bank charges' })}>Add / take out money</button>.</span></div>}</div>
        <div className="card ptxc"><div className="ptfil" style={{ padding: '12px 16px', alignItems: 'center' }}><div className="seg2 sm" id="bkrShow"><button data-show="all" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All entries</button><button data-show="open" className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>Not ticked</button></div><div className="sp" style={{ flex: 1 }}></div>
          <button className="btn sm" id="bkrAll" onClick={() => save({ ...st!, ticked: [...new Set([...st!.ticked, ...U.map((e) => e.key)])] })}>Tick all</button><button className="btn sm" id="bkrNone" onClick={() => save({ ...st!, ticked: [] })}>Clear ticks</button></div>
          <p className="hint" style={{ margin: '0 16px 10px' }}>Tick each entry that also appears on your bank statement. When the difference is zero, your books match the bank.</p>
          <div className="tw" style={{ margin: 0 }}><table className="ptt2 bkt"><thead><tr><th style={{ width: 44 }}><span className="vh">On statement</span></th><th>Date</th><th>Particulars</th><th>Mode / ref</th><th className="n">Money in</th><th className="n">Money out</th></tr></thead>
            <tbody id="bkrRows">{R.length ? R.map((e) => {
              const on = tick.has(e.key), amt = Number(e.amt);
              return (
                <tr className={on ? 'bkrt' : ''} key={e.key}><td><input type="checkbox" className="bkrcb" data-bkr={e.key} checked={on} aria-label={`On statement: ${e.party || e.kind} ${inr2f(Math.abs(amt))}`} onChange={(ev) => save({ ...st!, ticked: ev.target.checked ? [...st!.ticked, e.key] : st!.ticked.filter((k) => k !== e.key) })} /></td><td>{dmy(e.date)}</td>
                  <td><b className="bkpn">{e.party || e.kind}</b><small className="mu">{e.party ? e.kind : ''}{e.doc ? ' · ' + e.doc : ''}</small></td><td className="mu">{[e.mode, e.ref].filter(Boolean).join(' · ') || '—'}</td><td className="n pos">{amt > 0 ? inr2f(amt) : ''}</td><td className="n neg">{amt < 0 ? inr2f(-amt) : ''}</td></tr>
              );
            }) : <tr><td colSpan={6} className="ptempty">{U.length ? 'Every entry is ticked.' : 'No entries up to this date.'}</td></tr>}</tbody></table></div></div>
      </> : null}
      <MoveMoney open={move} accounts={accts.data} onClose={() => setMove(null)} />
    </section>
  );
}
