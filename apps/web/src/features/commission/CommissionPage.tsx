/**
 * Electrician commission (#vCom) — the prototype's renderCom with its windows: pay commission
 * (cmPay, including "Adjust against his bills"), the electrician's bills and payments (cmView),
 * add / edit electrician (elecEdit) and commission rules (cmRulesOpen).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { useFitTables } from '../../lib/useFitTables';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { SlModal, type SlModalProps } from '../sales/SlModal';
import { qfmt } from '../items/ItemsPage';
import type { Item } from '../items/ItemsPage';

interface Elec {
  id: string; name: string; phone: string; city: string; partyId: string | null; partyBalance: string | null;
  bills: number; business: string; comm: string; ret: string; earned: string; paid: string; due: string;
  invoices: { id: string; number: string; date: string; partyName: string; total: string; comm: string; ret: string; f: number; earned: string; returns: { cn: string; date: string; inv: string; item: string; qty: number; amt: string; reason: string }[] }[];
  payouts: { number: string; date: string; mode: string; note: string; amount: string }[];
}
interface Rule { category: string; kind: 'none' | 'percent' | 'fixed'; value: string }

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const CM_KEYS = ['commission', 'referrers', 'parties', 'receipts', 'sales', 'bank-accounts', 'bank-book', 'commission-rules'];
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
const setErr = (id: string, m: string) => { const e = document.getElementById(id); if (e) e.textContent = m; };

export function CommissionPage() {
  useFitTables();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const list = useQuery({ queryKey: ['commission'], queryFn: () => api<Elec[]>('/commission') });
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<SlModalProps | null>(null);
  if (!list.data) return <section id="vCom"></section>;
  const S2 = list.data;
  const T = (k: 'comm' | 'ret' | 'earned' | 'paid' | 'due') => Math.round(S2.reduce((a, x) => a + Number(x[k]), 0) * 100) / 100;
  const s = q.toLowerCase();
  const L = S2.filter((x) => !s || x.name.toLowerCase().includes(s) || x.phone.includes(s));
  const refresh = () => Promise.all(CM_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const close = () => setModal(null);

  const pay = (e: Elec) => {
    const owes = Math.max(0, Number(e.partyBalance ?? 0));
    setModal({
      title: `Pay commission · ${e.name}`, sub: `Payable now ${inr2f(e.due)} (earned ${inr2f(e.earned)} − paid ${inr2f(e.paid)})`, ok: 'Save payment', cancel: 'Cancel',
      body: <><div className="two"><label className="fl" htmlFor="cpA">Amount<input className="fi n" id="cpA" inputMode="decimal" defaultValue={String(Number(e.due))} autoFocus onFocus={(ev) => ev.target.select()} /></label>
        <label className="fl" htmlFor="cpM">Paid by<select className="fi" id="cpM" defaultValue={e.partyId && owes > 0 ? 'Adjust' : 'Cash'}>{e.partyId ? <option value="Adjust" disabled={!(owes > 0)}>Adjust against his bills{owes > 0 ? ` (owes ${inr2f(owes)})` : ' (no dues)'}</option> : null}<option>Cash</option><option>UPI</option><option>Bank transfer</option></select></label></div>
        <label className="fl" htmlFor="cpN">Note<input className="fi" id="cpN" autoComplete="off" placeholder="Optional" /></label><div className="msg bad" id="cpErr"></div></>,
      onOk: async () => {
        const a = Number(val('cpA').replace(/[^\d.]/g, '')) || 0, mode = val('cpM');
        if (!(a > 0)) return setErr('cpErr', 'Enter the amount.');
        try {
          await api('/commission/payouts', { method: 'POST', body: { referrerId: e.id, amount: String(a), mode, note: val('cpN').trim() } });
          close(); await refresh();
          showToast(mode === 'Adjust' ? `${inr2f(a)} commission adjusted in ${e.name}’s account` : `${inr2f(a)} commission paid to ${e.name}`);
        } catch (err) { setErr('cpErr', err instanceof ApiError ? err.message : 'Could not save the payment.'); }
      },
    });
  };

  const view = (e: Elec) => {
    const R = e.invoices.flatMap((b) => b.returns);
    const due = Number(e.due);
    setModal({
      title: e.name, sub: `${e.bills} bills · business ${inr2f(e.business)} · ${due < 0 ? 'to recover ' + inr2f(-due) : 'payable now ' + inr2f(due)}`, wide: 1,
      body: <><div className="tw" style={{ margin: 0, maxHeight: '45vh', overflow: 'auto' }}><table className="ptt2 pyt"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th className="n">Bill</th><th className="n">Commission</th><th className="n">Paid by customer</th><th className="n">Earned</th></tr></thead>
        <tbody>{e.invoices.length ? e.invoices.map((b) => <tr key={b.id}><td className="mono">{b.number}</td><td>{dmy(b.date)}</td><td>{b.partyName}</td><td className="n">{inr2f(b.total)}</td><td className="n">{inr2f(b.comm)}{Number(b.ret) ? <small className="neg" style={{ display: 'block' }}>−{inr2f(b.ret)} returns</small> : null}</td><td className="n">{Math.round(b.f * 100)}%</td><td className="n"><b>{inr2f(b.earned)}</b></td></tr>)
          : <tr><td colSpan={7} className="ptempty">No referred bills yet.</td></tr>}</tbody></table></div>
        {R.length ? <><h4 style={{ margin: '14px 0 6px' }}>Commission deducted for returns</h4><div className="tw" style={{ margin: 0 }}><table className="ptt2 pyt"><thead><tr><th>Date</th><th>Credit note</th><th>Invoice</th><th>Item returned</th><th>Reason</th><th className="n">Deducted</th></tr></thead>
          <tbody>{R.map((x, k) => <tr key={k}><td>{dmy(x.date)}</td><td className="mono">{x.cn}</td><td className="mono">{x.inv}</td><td>{qfmt(x.qty)} × {x.item}</td><td>{x.reason}</td><td className="n neg"><b>−{inr2f(x.amt)}</b></td></tr>)}</tbody></table></div></> : null}
        {e.payouts.length ? <><h4 style={{ margin: '14px 0 6px' }}>Payments to {e.name}</h4><div className="tw" style={{ margin: 0 }}><table className="ptt2 pyt"><tbody>{e.payouts.map((x) => <tr key={x.number}><td className="mono">{x.number}</td><td>{dmy(x.date)}</td><td>{x.mode}</td><td className="mu">{x.note}</td><td className="n"><b>{inr2f(x.amount)}</b></td></tr>)}</tbody></table></div></> : null}</>,
    });
  };

  const edit = (e: Elec | null) => setModal({
    title: e ? 'Edit electrician' : 'Add electrician', ok: 'Save', cancel: 'Cancel',
    body: <><label className="fl" htmlFor="elN">Name<input className="fi" id="elN" defaultValue={e?.name ?? ''} autoComplete="off" autoFocus /></label><div className="two"><label className="fl" htmlFor="elP">Mobile<input className="fi" id="elP" inputMode="numeric" defaultValue={e?.phone ?? ''} autoComplete="off" /></label><label className="fl" htmlFor="elC">City<input className="fi" id="elC" defaultValue={e?.city ?? ''} autoComplete="off" /></label></div><div className="msg bad" id="elErr"></div></>,
    onOk: async () => {
      const n = val('elN').trim(), ph = val('elP').replace(/\D/g, '');
      if (!n) { setErr('elErr', 'Enter the name.'); return document.getElementById('elN')?.focus(); }
      if (ph && ph.length !== 10) { setErr('elErr', 'Mobile should be 10 digits.'); return document.getElementById('elP')?.focus(); }
      try {
        await api(e ? `/referrers/${e.id}` : '/referrers', { method: e ? 'PATCH' : 'POST', body: { name: n, phone: ph, city: val('elC').trim() } });
        close(); await refresh(); showToast(`${n} saved`);
      } catch (err) { setErr('elErr', err instanceof ApiError ? err.message : 'Could not save.'); }
    },
  });

  const rules = async () => {
    const [R, items] = await Promise.all([qc.fetchQuery({ queryKey: ['commission-rules'], queryFn: () => api<Rule[]>('/commission-rules') }), qc.fetchQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items') })]);
    const cats = [...new Set([...items.map((i) => i.category).filter(Boolean), ...R.map((r) => r.category)])].sort();
    const by = new Map(R.map((r) => [r.category, r]));
    setModal({
      wide: 'min(620px,100%)', title: 'Commission rules', sub: 'Commission is added on top of the sale price (purchase + your margin) for each category.', ok: 'Save rules', cancel: 'Cancel',
      body: <><div className="cmrl">{cats.map((c) => { const r = by.get(c); const t = r?.kind === 'percent' ? 'p' : r?.kind === 'fixed' ? 'f' : 'n'; return (
        <div className="cmr" data-cat={c} key={c}><span><b>{c}</b><small className="mu">{items.filter((i) => i.category === c).length} items</small></span>
          <select className="fi sm" data-k="t" defaultValue={t} onChange={(ev) => { const i = ev.target.parentElement!.querySelector<HTMLInputElement>('[data-k="v"]')!; i.disabled = ev.target.value === 'n'; if (ev.target.value === 'n') i.value = ''; else i.focus(); }}><option value="n">No commission</option><option value="p">% of sale price</option><option value="f">Flat ₹ per unit</option></select>
          <input className="fi sm n" data-k="v" inputMode="decimal" defaultValue={t === 'n' ? '' : String(Number(r!.value))} placeholder="0" disabled={t === 'n'} /></div>); })}</div>
        <p className="hint" style={{ margin: '8px 0 0' }}>Example: purchase 300 + margin 10% = sale price 330 → commission 10% → rate on the bill 363. Electrician earns 33.</p></>,
      onOk: async () => {
        const rows = [...document.querySelectorAll<HTMLElement>('#slmBody .cmr')].map((r) => { const t = r.querySelector<HTMLSelectElement>('[data-k="t"]')!.value, v = Number(r.querySelector<HTMLInputElement>('[data-k="v"]')!.value.replace(/[^\d.]/g, '')) || 0; return { category: r.dataset.cat!, kind: t === 'n' || !v ? 'none' : t === 'p' ? 'percent' : 'fixed', value: t === 'n' ? 0 : v }; });
        try { for (const r of rows) await api('/commission-rules', { method: 'PUT', body: r }); close(); await refresh(); showToast('Commission rules saved'); }
        catch (err) { showToast(err instanceof ApiError ? err.message : 'Could not save the rules.'); }
      },
    });
  };

  return (
    <section id="vCom">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Electrician commission</h1><span className="pttot">Added on top of your sale price · paid as customers pay</span><div className="sp"></div><button className="btn" id="cmRules" onClick={() => void rules()}><Icon name="pct" />Commission rules</button><button className="btn p" id="cmAdd" onClick={() => edit(null)}><RawIcon d={PLUS} />Add electrician</button></div>
      <div className="sumrow" id="cmSum"><div><small>Commission on bills{T('ret') ? <> <span className="neg">(−{inr(T('ret').toFixed(2))} returns)</span></> : null}</small><b>{inr(T('comm').toFixed(2))}</b></div><div><small>Earned (customers paid)</small><b>{inr(T('earned').toFixed(2))}</b></div><div><small>Paid to electricians</small><b className="pos">{inr(T('paid').toFixed(2))}</b></div><div><small>Payable now</small><b className={T('due') > 0 ? 'neg' : ''}>{inr(T('due').toFixed(2))}</b></div></div>
      <div className="card ptxc"><div className="ptfil" style={{ padding: '12px 16px' }}><label className="search" htmlFor="cmQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="cmQ" placeholder="Search electrician" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Electrician</th><th className="n">Bills</th><th className="n">Business</th><th className="n">Commission</th><th className="n">Returns</th><th className="n">Earned<small className="mu" style={{ display: 'block', fontWeight: 500, textTransform: 'none' }}>on payment received</small></th><th className="n">Paid</th><th className="n">Payable now</th><th className="n"><span className="vh">Actions</span></th></tr></thead>
          <tbody id="cmRows" onKeyDown={(ev) => { const tr = (ev.target as HTMLElement).closest<HTMLElement>('tr[data-cme]'); if (tr && ev.key === 'Enter' && ev.target === tr) { ev.preventDefault(); tr.click(); } }}>
            {L.length ? L.map((e) => {
              const ret = Number(e.ret), due = Number(e.due), b = e.partyBalance === null ? null : Number(e.partyBalance);
              return (
                <tr tabIndex={0} data-cme={e.id} key={e.id} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button')) view(e); }}>
                  <td><b style={{ fontWeight: 600 }}>{e.name}</b><small className="mu" style={{ display: 'block' }}>{[e.phone && '+91 ' + e.phone, e.city].filter(Boolean).join(' · ')}</small>
                    {e.partyId && b !== null ? <span className="cmpb">{b > 0 ? <span className="neg">Owes you {inr2f(b)}</span> : b < 0 ? <span className="pos">Advance {inr2f(-b)}</span> : <span className="mu">No dues</span>} · <button type="button" className="lnk" data-cmledger={e.partyId} onClick={() => navigate(`/parties?sel=${e.partyId}`)}>Ledger</button> · <button type="button" className="lnk" data-cmbill={e.partyId} onClick={() => navigate(`/sales/new?party=${e.partyId}`)}>New bill</button></span> : null}</td>
                  <td className="n">{e.bills}</td><td className="n">{inr2f(e.business)}</td><td className="n">{inr2f(Number(e.comm) + ret)}</td><td className={`n ${ret ? 'neg' : 'mu'}`}>{ret ? '−' + inr2f(ret) : '—'}</td><td className="n">{inr2f(e.earned)}</td><td className="n pos">{Number(e.paid) ? inr2f(e.paid) : '—'}</td>
                  <td className="n"><b className={due > 0 ? 'neg' : ''}>{due < 0 ? 'Recover ' + inr2f(-due) : inr2f(due)}</b></td>
                  <td className="n" style={{ whiteSpace: 'nowrap' }}><button className="btn p sm" data-cmpay={e.id} disabled={!(due > 0)} onClick={() => pay(e)}>Pay</button> <button className="btn sm" data-cmedit={e.id} onClick={() => edit(e)}><Icon name="edit" /></button></td></tr>
              );
            }) : <tr><td colSpan={9}><div className="ptempty pue"><b>No electricians yet</b><span>Add the electricians who refer customers to you. Pick one in “Referred by” on a sale and the commission is added to the rates.</span></div></td></tr>}
          </tbody></table></div></div>
      <SlModal m={modal} onClose={close} />
    </section>
  );
}
