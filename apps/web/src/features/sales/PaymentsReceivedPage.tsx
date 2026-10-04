/**
 * Payments received (#vPin) and the Receive payment window (#rcm) — the
 * prototype's renderPin / rcOpen / rcSave. Money settles the customer's
 * oldest dues first; the amounts can be changed; the rest is an advance.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { money, PAY_MODES, saleStatus } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { useFitTables } from '../../lib/useFitTables';
import { useOpenFocus } from '../../lib/useOpenFocus';
import { Icon, RawIcon } from '../../components/Icon';
import { useDiscardGuard } from '../../components/Discard';
import { useShell } from '../shell/store';
import type { Party } from '../parties/PartiesPage';
import { inPeriod, type Period } from './model';
import { SlModal, type SlModalProps } from './SlModal';

export interface Receipt {
  id: string; number: string; date: string; party: { id: string; name: string; phone: string } | null; partyName: string; counter: boolean; mode: string; reference: string;
  against: string; cancelledInvoice: string | null; amount: string; unused: string; atSale: boolean; legacy: boolean;
}
interface Due { to: string; kind: 'opening' | 'invoice'; number: string; date: string; dueDate: string | null; total: string; balance: string }

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const against = (x: Receipt) => (x.number.startsWith('XP-') ? `Extra on ${x.number.slice(3)}` : x.counter ? x.against : x.against);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function PaymentsReceivedPage() {
  useFitTables();
  const [params, setParams] = useSearchParams();
  // from a party statement: open that document (prototype rcView / cnView)
  const loc = useLocation(), nav = useNavigate();
  const [want, setWant] = useState<string | null>((loc.state as { view?: string } | null)?.view ?? null);
  useEffect(() => { if ((loc.state as { view?: string } | null)?.view) nav('.', { replace: true, state: null }); }, [loc.state, nav]);
  const list = useQuery({ queryKey: ['receipts'], queryFn: () => api<Receipt[]>('/receipts') });
  const parties = useQuery({ queryKey: ['parties'], queryFn: () => api<Party[]>('/parties') });
  const [q, setQ] = useState('');
  const [per, setPer] = useState<Period>('all');
  const [mode, setMode] = useState('all');
  const [rc, setRc] = useState<{ party?: string; invoice?: string } | null>(null);
  const [modal, setModal] = useState<SlModalProps | null>(null);
  // from the sales list: "Receive payment" on an invoice
  useEffect(() => {
    const p = params.get('party');
    if (p !== null) { setRc({ party: p || undefined, invoice: params.get('invoice') ?? undefined }); setParams({}, { replace: true }); }
  }, [params, setParams]);

  if (!list.data || !parties.data) return <section id="vPin"></section>;
  const A = list.data.filter((x) => inPeriod(x.date, per));
  const tot = A.reduce((a, x) => a.plus(x.amount), money(0));
  const un = A.reduce((a, x) => a.plus(x.unused), money(0));
  const toCollect = parties.data.filter((p) => p.kind !== 'supplier').reduce((a, p) => a.plus(Number(p.balance) > 0 ? p.balance : 0), money(0));
  const s = q.toLowerCase();
  const L = A.filter((x) => (mode === 'all' || x.mode.includes(mode)) && (!s || x.number.toLowerCase().includes(s) || x.partyName.toLowerCase().includes(s) || x.reference.toLowerCase().includes(s) || against(x).toLowerCase().includes(s)));
  const view = (x: Receipt) => setModal(receiptModal(x));
  if (want) { const x = list.data.find((y) => y.number === want); setWant(null); if (x) queueMicrotask(() => view(x)); }
  return (
    <section id="vPin">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Payments received</h1><span className="pttot">Money in from customers</span><div className="sp"></div><button className="btn p" id="rcNew" onClick={() => setRc({})}><RawIcon d={PLUS} />Receive payment <kbd className="kh" style={{ marginLeft: 6, background: 'transparent', color: 'inherit', borderColor: 'rgba(255,255,255,.4)' }}>Alt+R</kbd></button></div>
      <div className="card ptxc"><div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><label className="search" htmlFor="rcQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="rcQ" placeholder="Search receipt, party or reference" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="sumrow sumin" id="rcSum"><div><small>Received</small><b className="pos">{inr(tot.toFixed(2))}</b></div><div><small>Receipts</small><b>{A.length}</b></div><div><small>Advance (unused)</small><b>{inr(un.toFixed(2))}</b></div><div><small>Still to collect</small><b className="neg">{inr(toCollect.toFixed(2))}</b></div></div>
        <div className="seg2 sm" id="rcPer">{(['all', 'oct', 'sep'] as const).map((k) => <button data-per={k} className={per === k ? 'on' : ''} key={k} onClick={() => setPer(k)}>{k === 'all' ? 'All' : k === 'oct' ? 'This month' : 'Last month'}</button>)}</div>
        <select className="fi" id="rcMode" aria-label="Mode" style={{ width: 'auto' }} value={mode} onChange={(e) => setMode(e.target.value)}><option value="all">All modes</option>{PAY_MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Receipt no.</th><th>Party</th><th>Mode</th><th>Reference</th><th>Against</th><th className="n">Amount</th><th className="n">Unused</th></tr></thead>
          <tbody id="rcRows" onKeyDown={(e) => { const r = (e.target as HTMLElement).closest<HTMLElement>('tr[data-rcno]'); if (r && e.key === 'Enter') { e.preventDefault(); r.click(); } }}>
            {L.length ? L.map((x) => (
              <tr tabIndex={0} data-rcno={x.number} data-rcp={x.party?.id ?? ''} key={x.id} onClick={() => view(x)}><td>{dmy(x.date)}</td><td className="mono">{x.number}{!x.atSale ? <> <span className="st b" style={{ fontSize: 10, padding: '1px 6px' }}>New</span></> : null}</td><td><b style={{ fontWeight: 600 }}>{x.partyName}</b>{x.counter ? <> <small className="mu">counter sale</small></> : null}</td>
                <td>{x.mode}</td><td className="mono mu">{x.reference || '—'}</td><td>{against(x) ? <span className="mono">{against(x)}</span> : Number(x.unused) > 0 ? <span className="st a">Advance</span> : <span className="mu">On account</span>}</td><td className="n"><b>{inr2f(x.amount)}</b></td><td className={`n ${Number(x.unused) > 0 ? 'lowq' : 'mu'}`}>{Number(x.unused) > 0 ? inr2f(x.unused) : '—'}</td></tr>
            )) : <tr><td colSpan={8}><div className="ptempty pue"><b>No payments found</b><span>Record money you receive from customers. It settles their oldest invoices first.</span><button className="btn p sm" id="rcNew2" onClick={() => setRc({})}>Receive payment</button></div></td></tr>}
          </tbody></table></div></div>
      <ReceiveDialog open={rc} parties={parties.data} onClose={() => setRc(null)} />
      <SlModal m={modal} onClose={() => setModal(null)} />
    </section>
  );
}

/** A receipt's details in the small window (prototype rcView), also opened from the cash and bank books. */
export function receiptModal(x: Receipt): SlModalProps {
  const msg = `Dear ${x.partyName}, we have received ${inr2f(x.amount)} by ${x.mode}${x.reference ? ' (ref ' + x.reference + ')' : ''} on ${dmy(x.date)}. Receipt ${x.number}. Thank you!`;
  return {
    title: `Receipt ${x.number}`, sub: `${x.partyName} · ${dmy(x.date)}`,
    body: <><div className="rcv"><div><span>Amount</span><b>{inr2f(x.amount)}</b></div><div><span>Mode</span><b>{x.mode}</b></div><div><span>Reference</span><b className="mono">{x.reference || '—'}</b></div><div><span>Against</span><b>{against(x) || (Number(x.unused) > 0 ? 'Advance' : 'On account')}</b></div>{Number(x.unused) > 0 ? <div><span>Unused advance</span><b className="lowq">{inr2f(x.unused)}</b></div> : null}</div>
      {x.party?.phone ? <a className="btn sm" style={{ marginTop: 14, textDecoration: 'none' }} target="_blank" rel="noopener" href={`https://wa.me/91${x.party.phone}?text=${encodeURIComponent(msg)}`}><Icon name="chat" />Send receipt on WhatsApp</a> : null}</>,
  };
}

/** Receive payment (#rcm). `open.party` / `open.invoice` pre-fill it from a party or an invoice. */
export function ReceiveDialog({ open, parties, onClose }: { open: { party?: string; invoice?: string } | null; parties: Party[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const [party, setParty] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<string>('UPI');
  const [refNo, setRefNo] = useState('');
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isOpen = !!open;
  const no = useQuery({ queryKey: ['next-number', 'receipt'], queryFn: () => api<{ number: string }>('/sales/next-number?kind=receipt'), enabled: isOpen });
  const dues = useQuery({ queryKey: ['dues', party], queryFn: () => api<Due[]>(`/parties/${party}/dues`), enabled: isOpen && !!party });
  useOpenFocus(isOpen, ref);
  const close = useDiscardGuard(isOpen, ref, 'payment', onClose);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!isOpen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.getElementById('dcf')?.hidden !== false && document.getElementById('slm')?.hidden !== false) closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [isOpen]);
  const auto = (amt: number, D: Due[]) => { let left = amt; const a: Record<string, number> = {}; for (const t of D) { if (left <= 0) break; const u = r2(Math.min(left, Number(t.balance))); a[t.to] = u; left = r2(left - u); } return a; };
  // reset when opened; pick the customer and fill in their dues
  useEffect(() => {
    if (!open) return;
    setParty(open.party ?? ''); setAmount(''); setDate(today()); setMode('UPI'); setRefNo(''); setAlloc({}); setErr('');
    setTimeout(() => (document.getElementById(open.party ? 'rcAmt' : 'rcParty') as HTMLElement | null)?.focus(), 30);
  }, [open]);
  const D = party ? dues.data ?? [] : [];
  const filled = useRef('');
  useEffect(() => {
    if (!open || !party || !dues.data || filled.current === party + (open.invoice ?? '')) return;
    filled.current = party + (open.invoice ?? '');
    if (open.invoice && open.party === party) { const t = dues.data.find((x) => x.to === open.invoice); if (t) { setAlloc({ [t.to]: Number(t.balance) }); setAmount(String(Number(t.balance))); } return; }
    const tot = r2(dues.data.reduce((a, t) => a + Number(t.balance), 0));
    if (tot > 0) { setAmount(String(tot)); setAlloc(auto(tot, dues.data)); }
  }, [open, party, dues.data]);
  useEffect(() => { if (!open) filled.current = ''; }, [open]);

  const C = parties.filter((p) => p.kind !== 'supplier').sort((a, b) => Math.max(0, Number(b.balance)) - Math.max(0, Number(a.balance)) || a.name.localeCompare(b.name));
  const used = r2(Object.values(alloc).reduce((a, b) => a + (b || 0), 0));
  const amt = Number(amount) || 0;
  const save = async () => {
    if (!party) { setErr('Choose the customer.'); return document.getElementById('rcParty')?.focus(); }
    if (!(amt > 0)) { setErr('Enter the amount received.'); return document.getElementById('rcAmt')?.focus(); }
    if (mode === 'Cheque' && !refNo.trim()) { setErr('Enter the cheque number.'); return document.getElementById('rcRef')?.focus(); }
    const A = Object.entries(alloc).filter(([, a]) => a > 0).map(([to, a]) => { const t = D.find((x) => x.to === to); return { to, amount: String(r2(Math.min(a, t ? Number(t.balance) : 0))) }; }).filter((a) => Number(a.amount) > 0);
    if (A.reduce((s2, a) => s2 + Number(a.amount), 0) > amt + 0.009) return setErr('The invoice amounts add up to more than the payment.');
    setBusy(true);
    try {
      const r = await api<{ number: string; amount: string; partyName: string }>('/receipts', { method: 'POST', body: { partyId: party, date, amount: String(amt), mode, ref: refNo.trim(), allocations: A } });
      onClose();
      await Promise.all(['receipts', 'sales', 'parties', 'dues', 'next-number', 'sale'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`${r.number} · ${inr2f(amt)} received from ${r.partyName}`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save the payment.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="ov c" id="rcm" hidden={!isOpen} ref={ref} onClick={(e) => { if ((e.target as HTMLElement).id === 'rcm') close(); }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="rcT" style={{ width: 'min(600px,100%)' }}>
        <div className="dh"><div><h3 id="rcT" style={{ margin: 0, fontSize: 18 }}>Receive payment</h3><small className="mu mono" id="rcNo">{no.data?.number ?? ''}</small></div><button className="ib" type="button" id="rcClose" aria-label="Close" onClick={close}><Icon name="x" /></button></div>
        <label className="fl" htmlFor="rcParty" style={{ marginTop: 14 }}>Customer<select className="fi" id="rcParty" value={party} onChange={(e) => { setParty(e.target.value); setAlloc({}); setAmount(''); filled.current = ''; setTimeout(() => (document.getElementById('rcAmt') as HTMLInputElement | null)?.select(), 50); }}>
          <option value="">Choose customer</option>{C.map((p) => { const b = Number(p.balance); return <option value={p.id} key={p.id}>{p.name}{b > 0 ? ' · ' + inr2f(b) + ' due' : b < 0 ? ' · advance ' + inr2f(-b) : ''}</option>; })}</select></label>
        <div className="two"><label className="fl" htmlFor="rcAmt">Amount received<input className="fi" id="rcAmt" inputMode="decimal" placeholder="0" autoComplete="off" value={amount} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setAmount(v); setAlloc(auto(Number(v) || 0, D)); }} /></label><label className="fl" htmlFor="rcDate">Date<input className="fi" type="date" id="rcDate" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        <div className="two"><label className="fl" htmlFor="rcModeI">Mode<select className="fi" id="rcModeI" value={mode} onChange={(e) => setMode(e.target.value)}>{PAY_MODES.map((m) => <option key={m}>{m}</option>)}</select></label><label className="fl" htmlFor="rcRef">Reference<input className="fi" id="rcRef" placeholder="UPI ref, UTR, cheque no." autoComplete="off" value={refNo} onChange={(e) => setRefNo(e.target.value)} /></label></div>
        <div className="pyb"><b>Settle against invoices</b><small className="mu">Oldest invoices are filled first. Change the amounts if needed.</small>
          <div id="rcBills">{!party ? <p className="mu" style={{ margin: 0, fontSize: 13 }}>Choose a customer to see their unpaid invoices.</p> : D.length ? (
            <table className="ptt2 pyt"><thead><tr><th>Invoice</th><th>Date</th><th className="n">Balance</th><th className="n">Receive</th></tr></thead><tbody>{D.map((t) => {
              const st = t.kind === 'opening' ? { t: 'Unpaid', c: 'a' } : saleStatus({ total: Number(t.total), balance: Number(t.balance), due: t.dueDate }, today());
              return <tr key={t.to}><td className="mono">{t.kind === 'opening' ? 'Opening balance' : t.number}<small className="mu" style={{ display: 'block' }}><span className={`stt ${st.c}`}>{st.t}</span></small></td><td>{dmy(t.date)}</td><td className="n">{inr2f(t.balance)}</td>
                <td className="n"><input className="fi sm n" data-rca={t.to} value={alloc[t.to] || ''} placeholder="0" inputMode="decimal" style={{ width: 110 }} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); const nx = { ...alloc, [t.to]: Number(v) || 0 }; setAlloc(nx); const u = Object.values(nx).reduce((a, b) => a + (b || 0), 0); if (u > amt) setAmount(String(r2(u))); }} /></td></tr>;
            })}</tbody></table>
          ) : <p className="mu" style={{ margin: 0, fontSize: 13 }}>No unpaid invoices. This payment will be kept as an advance.</p>}</div>
          <div className="pysum" id="rcSumI">{amt ? <>Against invoices {inr2f(used)}{amt - used > 0.009 ? <> · <b>Advance {inr2f(r2(amt - used))}</b></> : null}{used - amt > 0.009 ? <> · <span className="neg">{inr2f(r2(used - amt))} more than the amount</span></> : null}</> : null}</div></div>
        <div className="msg bad" id="rcErr" role="alert">{err}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" type="button" id="rcCancel" onClick={close}>Cancel</button><button className="btn p" type="button" id="rcSave" disabled={busy} onClick={() => void save()}>Save receipt</button></div>
      </div>
    </div>
  );
}
