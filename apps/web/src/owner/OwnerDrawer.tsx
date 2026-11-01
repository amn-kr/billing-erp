/**
 * The customer drawer: details, subscription, "Activate a plan" / "Renew or change plan", Extend trial,
 * Suspend / Reactivate and Payment history. Same markup and wording as the design's drawer(), with the owner's
 * approved changes (1 Nov 2026): one "Paid plan" box and a typed "Amount received (₹)" instead of the design's
 * three priced plans; no "Yearly offer" line (there are no fixed prices).
 */
import { useEffect, useState, type FormEvent, type RefObject } from 'react';
import { addDays, firstError, formatInr0, formatInr2, money, ownerPlanSchema, PAID_BY, planEndsOn, PLAN_MONTHS, type OwnerCustomer, type OwnerCustomerDetail, type OwnerPayment, type PaidBy, type PlanMonths } from '@billing/shared';
import { ownerApi, OwnerApiError } from './api';
import { OwnerIcon } from './Icon';
import { daysLeft, fmt, mobileOf, PAID_PLAN, status, TRIAL_DAYS, VIA } from './format';

const PERIODS: [PlanMonths, string][] = PLAN_MONTHS.map((m) => [m, m === 1 ? '1 month' : `${m} months`]);
const msgOf = (e: unknown) => (e instanceof OwnerApiError ? e.message : 'Something went wrong.');
/** the design's inr(): ₹1,500 (paise only when there are some) */
const inr = (v: string) => {
  const m = money(v);
  return '₹' + (m.isInteger() ? formatInr0(m) : formatInr2(m));
};

interface Form { m: PlanMonths; start: string; mode: PaidBy; amt: string; ref: string; err: string }

/** the design's startFor(): the day after a running plan ends, else today */
const startFor = (c: OwnerCustomer, today: string) => (c.plan === 'paid' && c.paidUntil && daysLeft(c.paidUntil, today) >= 0 ? addDays(c.paidUntil, 1) : today);
const fresh = (c: OwnerCustomer, today: string): Form => ({ m: 1, start: startFor(c, today), mode: 'UPI', amt: '', ref: '', err: '' });

export function OwnerDrawer({ c, today, closeRef, onClose, onChanged, toast }: {
  c: OwnerCustomer; today: string; closeRef: RefObject<HTMLButtonElement>;
  onClose: () => void; onChanged: (c: OwnerCustomer) => void; toast: (m: string) => void;
}) {
  const [payments, setPayments] = useState<OwnerPayment[] | null>(null);
  const [f, setF] = useState<Form>(() => fresh(c, today));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    void ownerApi<OwnerCustomerDetail>(`/customers/${c.id}`).then((d) => setPayments(d.payments)).catch((e) => toast(msgOf(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  function done(d: OwnerCustomerDetail) {
    onChanged(d.customer);
    setPayments(d.payments);
  }

  async function act(path: 'suspend' | 'reactivate' | 'extend-trial') {
    setBusy(true);
    try {
      if (path === 'extend-trial') {
        const d = await ownerApi<OwnerCustomerDetail>(`/customers/${c.id}/extend-trial`, { method: 'POST' });
        done(d);
        toast(`Trial for ${c.code} extended to ${fmt(d.customer.trialEndsOn)}`);
      } else {
        onChanged(await ownerApi<OwnerCustomer>(`/customers/${c.id}/${path}`, { method: 'POST' }));
        toast(path === 'suspend' ? `${c.code} suspended. They can’t sign in until you reactivate.` : `${c.code} reactivated`);
      }
    } catch (e) {
      toast(msgOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const input = { months: f.m, startsOn: f.start, paidBy: f.mode, amount: f.amt, reference: f.ref };
    const v = ownerPlanSchema.safeParse(input);
    if (!v.success) {
      set({ err: firstError(v.error) });
      const field = v.error.issues[0]?.path[0];
      setTimeout(() => document.getElementById(field === 'reference' ? 'aRef' : field === 'amount' ? 'aAmt' : 'aStart')?.focus(), 0);
      return;
    }
    const renew = c.plan === 'paid' && !!c.paidUntil && daysLeft(c.paidUntil, today) >= 0;
    setBusy(true);
    try {
      const d = await ownerApi<OwnerCustomerDetail>(`/customers/${c.id}/plan`, { body: input });
      done(d);
      setF(fresh(d.customer, today));
      toast(`${c.code} ${renew ? 'renewed' : 'activated'}: ${PAID_PLAN} till ${fmt(d.customer.paidUntil!)}`);
    } catch (x) {
      set({ err: msgOf(x) });
    } finally {
      setBusy(false);
    }
  }

  const s = status(c, today);
  const v = VIA[c.via];
  const paid = c.plan === 'paid' && !!c.paidUntil;
  const renew = paid && daysLeft(c.paidUntil!, today) >= 0;
  const end = f.start ? planEndsOn(f.start, f.m) : '';
  let amt = '₹0';
  try { if (f.amt.trim() && money(f.amt).gt(0)) amt = inr(f.amt); } catch { /* not a number yet */ }

  let box;
  if (paid) {
    const since = payments?.[0]?.paidOn ?? c.enrolled;
    const tot = Math.max(1, daysLeft(c.paidUntil!, since));
    const left = Math.max(0, daysLeft(c.paidUntil!, today));
    box = (
      <div className="subbox"><span className={`st ${s.k}`}>{s.t}</span><div className="big">{PAID_PLAN} plan</div>
        <div style={{ color: 'var(--t2)', fontSize: '12.5px' }}>{daysLeft(c.paidUntil!, today) >= 0 ? `Valid till ${fmt(c.paidUntil!)} · ${left} days left` : `Ended on ${fmt(c.paidUntil!)}`}</div>
        <div className="meter"><i style={{ width: `${Math.min(100, (left / tot) * 100)}%`, background: s.k === 'active' ? 'var(--green)' : s.k === 'soon' ? 'var(--amber)' : 'var(--red)' }} /></div></div>
    );
  } else {
    const d = daysLeft(c.trialEndsOn, today);
    box = (
      <div className="subbox"><span className={`st ${s.k}`}>{s.t}</span><div className="big">Free trial</div>
        <div style={{ color: 'var(--t2)', fontSize: '12.5px' }}>{d >= 0 ? `All features open until ${fmt(c.trialEndsOn)}` : `Ended on ${fmt(c.trialEndsOn)}. The shop sees a reminder to choose a plan.`}</div>
        <div className="meter"><i style={{ width: `${Math.max(0, Math.min(100, ((d + 1) / TRIAL_DAYS) * 100))}%`, background: 'var(--blue)' }} /></div></div>
    );
  }

  return (
    <>
      <div className="dh"><div><span className="cid">{c.code}</span><h2 id="dT">{c.name}</h2><div style={{ color: 'var(--t2)', fontSize: '13px' }}>{c.ownerName}</div></div><button className="ib" id="dClose" aria-label="Close" ref={closeRef} onClick={onClose}><OwnerIcon name="x" /></button></div>
      <div className="sec">Customer</div>
      <div className="kv"><span>Business type</span><b>{c.businessType}</b></div>
      <div className="kv"><span>Mobile</span><b>{c.mobile ? mobileOf(c.mobile) : '—'}</b></div>
      <div className="kv"><span>Email</span><b>{c.email || '—'}</b></div>
      <div className="kv"><span>Enrolled via</span><b>{v[1]} · {fmt(c.enrolled)}</b></div>
      <div className="sec">Subscription</div>{box}
      {c.status === 'suspended' ? (
        <div className="acts" style={{ gridTemplateColumns: '1fr' }}><button className="btn p" id="unsusp" disabled={busy} onClick={() => void act('reactivate')}>Reactivate account</button></div>
      ) : (
        <>
          <div className="sec">{renew ? 'Renew or change plan' : 'Activate a plan'}</div>
          <form id="af" noValidate onSubmit={onSubmit}>
            <span className="fl" style={{ margin: 0 }}>Plan</span>
            <div className="plans" role="radiogroup" aria-label="Plan" style={{ gridTemplateColumns: '1fr' }}><button type="button" role="radio" aria-checked="true" className="on" data-plan="paid"><b>{PAID_PLAN} plan</b><small>All features · you set the amount</small></button></div>
            <span className="fl" style={{ margin: 0 }}>Period</span>
            <div className="seg" role="radiogroup" aria-label="Period">
              {PERIODS.map(([m, label]) => <button key={m} type="button" role="radio" aria-checked={f.m === m} className={f.m === m ? 'on' : ''} data-m={m} onClick={() => set({ m })}>{label}</button>)}
            </div>
            <div className="two">
              <label className="fl" htmlFor="aStart">Starts on<input className="fi" type="date" id="aStart" value={f.start} onChange={(e) => set({ start: e.target.value })} /></label>
              <label className="fl" htmlFor="aMode">Paid by<select className="fi" id="aMode" value={f.mode} onChange={(e) => set({ mode: e.target.value as PaidBy })}>{PAID_BY.map((m) => <option key={m}>{m}</option>)}</select></label>
            </div>
            <label className="fl" htmlFor="aAmt">Amount received (₹)<input className="fi" id="aAmt" inputMode="decimal" autoComplete="off" value={f.amt} onChange={(e) => set({ amt: e.target.value })} /></label>
            <label className="fl" htmlFor="aRef">Payment reference<input className="fi" id="aRef" value={f.ref} placeholder="UPI ref, UTR or receipt number" autoComplete="off" onChange={(e) => set({ ref: e.target.value })} /></label>
            <div className="sum"><div><span>Valid from</span><b>{f.start ? fmt(f.start) : '—'}</b></div><div><span>Valid till</span><b>{end ? fmt(end) : '—'}</b></div><div className="tt"><span>Amount received</span><b>{amt}</b></div></div>
            <div className="err" id="aErr" role="alert">{f.err}</div>
            <button className="btn p" type="submit" disabled={busy} style={{ width: '100%', height: 46 }}>{renew ? 'Renew subscription' : 'Activate subscription'}</button>
          </form>
          <div className="acts">{!paid ? <button className="btn" id="ext" disabled={busy} onClick={() => void act('extend-trial')}>Extend trial by 7 days</button> : <span></span>}<button className="btn dg" id="susp" disabled={busy} onClick={() => void act('suspend')}>Suspend account</button></div>
        </>
      )}
      <div className="sec">Payment history</div>
      <div className="hist">
        {payments === null ? null : payments.length ? payments.map((p) => (
          <div key={p.id}><span>{fmt(p.paidOn)} · {PAID_PLAN}, {p.months} mo<br /><small>{p.paidBy} · {p.reference}</small></span><b>{inr(p.amount)}</b></div>
        )) : <div><span>No payments yet</span></div>}
      </div>
    </>
  );
}
