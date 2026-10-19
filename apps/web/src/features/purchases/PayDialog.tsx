/**
 * Record payment made (#ppm) — the prototype's openPayModal / renderPay / pySave.
 * Money settles the supplier's oldest bills first; the amounts can be changed;
 * the rest is kept as an advance.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PU_MODES } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon } from '../../components/Icon';
import { toastSaveFailed, toastSaved } from '../shell/saved';
import { useShell } from '../shell/store';
import { editAsk, withPasscode } from '../settings/passcode';
import type { Party } from '../parties/PartiesPage';
import { PU_KEYS, statusOfBill, type PaymentMadeDoc, type UnpaidBill } from './model';

/** `party` / `bill` (a bill id) pre-fill the window from a bill's Pay button; `edit` edits a saved payment (same number, passcode when it is on). */
export type PayOpen = { party?: string; bill?: string; edit?: string };
const r2 = (n: number) => Math.round(n * 100) / 100;

// the prototype keeps the last mode used while the app is open
let lastMode: string = 'Bank transfer';

export function PayDialog({ open, onClose }: { open: PayOpen | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const isOpen = !!open;
  const editId = open?.edit ?? null;
  const [doc, setDoc] = useState<PaymentMadeDoc | null>(null);
  const [party, setParty] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState(lastMode);
  const [refNo, setRefNo] = useState('');
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const parties = useQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties'), enabled: isOpen });
  const no = useQuery({ queryKey: ['next-number', 'payment'], queryFn: () => api<{ number: string }>('/purchases/next-number?kind=payment'), enabled: isOpen && !editId });
  // editing: the bills as if this payment had not paid them
  const bills = useQuery({ queryKey: ['unpaid-bills', party, editId], queryFn: () => api<UnpaidBill[]>(`/parties/${party}/unpaid-bills${editId ? `?payment=${editId}` : ''}`), enabled: isOpen && !!party });
  useOpenFocus(isOpen, ref);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [isOpen]);
  const B = party ? bills.data ?? [] : [];
  const auto = (amt: number, L: UnpaidBill[]) => { let left = amt; const a: Record<string, number> = {}; for (const b of L) { if (left <= 0) break; const u = Math.min(left, Number(b.balance)); a[b.id] = r2(u); left = r2(left - u); } return a; };
  // reset when opened
  const want = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setParty(open.party ?? ''); setAmount(''); setDate(today()); setMode(lastMode); setRefNo(''); setAlloc({}); setErr(''); setDoc(null);
    want.current = open.bill ?? null;
    if (open.edit) {
      void qc.fetchQuery({ queryKey: ['payment-made', open.edit], queryFn: () => api<PaymentMadeDoc>(`/payments-made/${open.edit}`), staleTime: 0 }).then((d) => {
        if (d.locked) { showToast(d.locked); onClose(); return; }
        setDoc(d); setParty(d.partyId ?? ''); setAmount(String(Number(d.amount))); setDate(d.date); setMode(d.mode); setRefNo(d.ref);
        setAlloc(Object.fromEntries(d.allocations.map((a) => [a.to, Number(a.amount)])));
        setTimeout(() => (document.getElementById('pyAmt') as HTMLInputElement | null)?.select(), 30);
      }, (e) => { showToast(e instanceof ApiError ? e.message : 'Could not open the payment.'); onClose(); });
      return;
    }
    setTimeout(() => (document.getElementById(open.party ? 'pyAmt' : 'pySup') as HTMLElement | null)?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // from a bill's Pay button: that bill's balance
  useEffect(() => {
    if (!want.current || !bills.data) return;
    const b = bills.data.find((x) => x.id === want.current);
    want.current = null;
    if (b) { setAlloc({ [b.id]: Number(b.balance) }); setAmount(String(Number(b.balance))); }
  }, [bills.data]);
  // choosing a supplier with an amount typed fills their oldest bills
  const pending = useRef(false);
  useEffect(() => { if (pending.current && bills.data) { pending.current = false; setAlloc(auto(Number(amount) || 0, bills.data)); } }, [bills.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // editing a payment to a party that is not a supplier keeps that party in the list
  const S = (parties.data ?? []).filter((p) => p.kind === 'supplier' || (!!doc && p.id === doc.partyId));
  const used = r2(Object.values(alloc).reduce((a, b) => a + (b || 0), 0));
  const amt = Number(amount) || 0;
  const save = async () => {
    const fail = (m: string) => { setErr(m); toastSaveFailed(m); };
    if (!party) { fail('Choose the supplier.'); return document.getElementById('pySup')?.focus(); }
    if (!(amt > 0)) { fail('Enter the amount paid.'); return document.getElementById('pyAmt')?.focus(); }
    const A = Object.entries(alloc).filter(([, a]) => a > 0).map(([to, a]) => { const b = B.find((x) => x.id === to); return { to, amount: String(r2(Math.min(a, b ? Number(b.balance) : 0))) }; }).filter((a) => Number(a.amount) > 0);
    if (A.reduce((s, a) => s + Number(a.amount), 0) > amt + 0.009) return fail('The bill amounts add up to more than the payment.');
    if (mode === 'Cheque' && !refNo.trim()) { fail('Enter the cheque number.'); return document.getElementById('pyRef')?.focus(); }
    setBusy(true);
    try {
      const body = { partyId: party, date, amount: String(amt), mode, ref: refNo.trim(), notes: doc?.notes ?? '', allocations: A };
      if (doc) { if (!(await withPasscode(qc, editAsk(doc.number), (h) => api(`/payments-made/${doc.id}`, { method: 'PUT', body, headers: h })))) return; }
      else await api('/payments-made', { method: 'POST', body });
      onClose();
      await Promise.all(PU_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toastSaved('payment');
    } catch (e) { fail(e instanceof ApiError ? e.message : 'Could not save the payment.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="ov c" id="ppm" hidden={!isOpen} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'ppm') onClose(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="pyT" style={{ width: 'min(560px,100%)' }}>
        <div className="dh"><div><h3 id="pyT" style={{ margin: 0, fontSize: 18 }}>{editId ? 'Edit payment made' : 'Record payment made'}</h3><small className="mu mono" id="pyNo">{editId ? (doc?.number ?? '') : (no.data?.number ?? '')}</small></div><button className="ib" type="button" id="pyCancel" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <label className="fl" htmlFor="pySup" style={{ marginTop: 14 }}>Supplier<select className="fi" id="pySup" value={party} onChange={(e) => { setParty(e.target.value); setAlloc({}); setErr(''); pending.current = !!Number(amount); }}>
          <option value="">Choose supplier</option>{S.map((p) => <option value={p.id} key={p.id}>{p.name} · {inr(Math.abs(Math.min(0, Number(p.balance))).toFixed(2))} to pay</option>)}</select></label>
        <div className="two"><label className="fl" htmlFor="pyAmt">Amount paid<input className="fi" id="pyAmt" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setAmount(v); setAlloc(auto(Number(v) || 0, B)); setErr(''); }} /></label><label className="fl" htmlFor="pyDate">Date<input className="fi" type="date" id="pyDate" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        <div className="two"><label className="fl" htmlFor="pyMode">Mode<select className="fi" id="pyMode" value={mode} onChange={(e) => { setMode(e.target.value); lastMode = e.target.value; }}>{PU_MODES.map((m) => <option key={m}>{m}</option>)}</select></label><label className="fl" htmlFor="pyRef">Reference<input className="fi" id="pyRef" placeholder="UTR, cheque no." autoComplete="off" value={refNo} onChange={(e) => setRefNo(e.target.value)} /></label></div>
        <div className="pyb"><b>Settle against bills</b><small className="mu">Oldest bills are filled first. Change the amounts if needed.</small>
          <div id="pyBills">{!party ? <p className="mu" style={{ margin: 0, fontSize: 13 }}>Choose a supplier to see their unpaid bills.</p> : !bills.data ? null : B.length ? (
            <table className="ptt2 pyt"><thead><tr><th>Bill</th><th>Date</th><th className="n">Balance</th><th className="n">Pay</th></tr></thead><tbody>{B.map((b) => {
              const st = statusOfBill(b);
              return <tr key={b.id}><td className="mono">{b.number}<small className="mu" style={{ display: 'block' }}><span className={`stt ${st.c}`}>{st.t}</span></small></td><td>{dmy(b.date)}</td><td className="n">{inr2f(b.balance)}</td>
                <td className="n"><input className="fi sm n" data-pya={b.number} value={alloc[b.id] || ''} placeholder="0" inputMode="decimal" style={{ width: 110 }} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); const nx = { ...alloc, [b.id]: Number(v) || 0 }; setAlloc(nx); const u = Object.values(nx).reduce((a, x) => a + (x || 0), 0); if (u > amt) setAmount(String(r2(u))); }} /></td></tr>;
            })}</tbody></table>
          ) : <p className="mu" style={{ margin: 0, fontSize: 13 }}>No unpaid bills. The payment will be kept as an advance.</p>}</div>
          <div className="pysum" id="pySum">{amt ? <>Against bills ₹{inr2f(used)}{amt - used > 0.009 ? <> · <b>Advance ₹{inr2f(r2(amt - used))}</b></> : null}{used - amt > 0.009 ? <> · <span className="neg">₹{inr2f(r2(used - amt))} more than the amount</span></> : null}</> : null}</div></div>
        <div className="msg bad" id="pyErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn p" type="button" id="pySave" disabled={busy} onClick={() => void save()}>Save payment</button></div>
      </div>
    </div>
  );
}
