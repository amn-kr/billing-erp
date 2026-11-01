/**
 * The software owner's panel (/owner): customers table, status chips, search and the customer drawer.
 * Same markup, classes and wording as reference/design/owner-panel.html, backed by /api/owner.
 * Owner's choices (1 Nov 2026): no "Sample data" label or browser note; one "Paid" plan (no fixed prices);
 * Business type shows the shop's mode ("General" until modes are added). The drawer is OwnerDrawer.tsx.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { OwnerCustomer, OwnerCustomers, OwnerMe } from '@billing/shared';
import { useStyles } from '../lib/useStyles';
import { APP_LETTER, APP_NAME } from '../lib/brand';
import { ownerApi, ownerSignOut, OwnerApiError } from './api';
import { OwnerDrawer } from './OwnerDrawer';
import { OwnerIcon, type OwnerIconName } from './Icon';
import { daysLeft, fmt, groupOf, mobileOf, PAID_PLAN, status, VIA, type Group } from './format';
import css from './owner.css?inline';

const NAV: ([OwnerIconName, string, true?] | [null, string])[] = [['users', 'Customers', true], ['layers', 'Plans'], ['rupee', 'Payments'], ['cal', 'Renewals'], [null, 'Account'], ['gear', 'Settings']];
const CHIPS: [Group, string, string?][] = [['all', 'All'], ['trial', 'On trial', 'var(--blue)'], ['active', 'Active', 'var(--green)'], ['expired', 'Expired', 'var(--red)'], ['susp', 'Suspended', 'var(--t2)']];
const msgOf = (e: unknown) => (e instanceof OwnerApiError ? e.message : 'Something went wrong.');

export function OwnerApp() {
  useStyles([css], 'owner');
  const [me, setMe] = useState<OwnerMe | null>(null);
  const [data, setData] = useState<OwnerCustomers | null>(null);
  const [filter, setFilter] = useState<Group>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [toastText, setToastText] = useState('');
  const [toastOn, setToastOn] = useState(false);
  const toastTimer = useRef<number>(0);
  const lastFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = `${APP_NAME} – Owner panel`;
    void (async () => {
      try {
        const [m, c] = await Promise.all([ownerApi<OwnerMe>('/me'), ownerApi<OwnerCustomers>('/customers')]);
        setMe(m);
        setData(c);
      } catch (e) {
        toast(msgOf(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toast(m: string) {
    setToastText(m);
    setToastOn(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastOn(false), 2600);
  }

  function open(id: string) {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setOpenId(id);
    setTimeout(() => closeRef.current?.focus(), 0);
  }
  function close() {
    setOpenId(null);
    lastFocus.current?.focus();
  }

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openId) close();
      setSideOpen(false);
    };
    const onClick = (e: globalThis.MouseEvent) => {
      const t = e.target as HTMLElement;
      if (sideRef.current && !sideRef.current.contains(t) && t.id !== 'menuBtn' && !t.closest('#menuBtn')) setSideOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  });

  /** a customer changed in the drawer (plan, trial, status): the table and chips follow */
  function changed(next: OwnerCustomer) {
    setData((d) => d && { ...d, customers: d.customers.map((x) => (x.id === next.id ? next : x)) });
  }

  function soon(e: MouseEvent, what: string) {
    e.preventDefault();
    toast(`${what} screen is coming next`);
    setSideOpen(false);
  }

  const today = data?.today ?? '';
  const all = data?.customers ?? [];
  const counts: Record<Group, number> = { all: all.length, trial: 0, active: 0, expired: 0, susp: 0 };
  all.forEach((c) => counts[groupOf(c, today)]++);
  const qq = q.trim().toLowerCase().replace(/\s/g, '');
  const list = all.filter((c) => (filter === 'all' || groupOf(c, today) === filter) && (!qq || c.code.toLowerCase().includes(qq) || c.mobile.includes(qq) || c.email.toLowerCase().includes(qq)));
  const cur = openId ? all.find((c) => c.id === openId) ?? null : null;

  return (
    <>
      <div className="app">
        <aside className={sideOpen ? 'side open' : 'side'} id="side" aria-label="Owner menu" ref={sideRef}>
          <div className="sbh"><div className="logo">{APP_LETTER}</div><div><b>{APP_NAME}</b><small>Owner panel</small></div></div>
          <nav id="nav">
            {NAV.map((n) =>
              n[0] === null ? <div className="nl" key={n[1]}>{n[1]}</div> : n[2] ? (
                <a href="#" className="ni on" aria-current="page" key={n[1]} onClick={(e) => e.preventDefault()}><OwnerIcon name={n[0]} />{n[1]}<span className="ct" id="navCt">{data ? all.length : ''}</span></a>
              ) : (
                <a href="#" className="ni " data-soon={n[1]} key={n[1]} onClick={(e) => soon(e, n[1])}><OwnerIcon name={n[0]} />{n[1]}</a>
              ),
            )}
          </nav>
          <div className="me"><div className="av">{(me?.name ?? '').charAt(0).toUpperCase()}</div><div><b>{me?.name}</b><small>Software owner · <a href="#" id="signOut" style={{ color: 'inherit' }} onClick={(e) => { e.preventDefault(); void ownerSignOut(); }}>Sign out</a></small></div></div>
        </aside>
        <div style={{ minWidth: 0 }}>
          <header className="top">
            <button className="ib menu" id="menuBtn" aria-label="Open menu" onClick={(e) => { e.stopPropagation(); setSideOpen((v) => !v); }}><OwnerIcon name="menu" /></button>
            <label className="search" htmlFor="q"><span id="qi"><OwnerIcon name="search" /></span><input id="q" placeholder="Search by customer ID, mobile or email" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </header>
          <main className="page">
            <div className="hero">
              <div><h1>Customers</h1><p>Everyone who has signed up. Click a customer to activate or renew their plan.</p></div>
              <button className="btn p" id="addBtn" onClick={() => toast('Add customer form is coming next')}><OwnerIcon name="plus" />Add customer</button>
            </div>
            <div className="chips" id="chips" role="tablist" aria-label="Filter by status">
              {CHIPS.map(([k, label, dot]) => (
                <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} data-f={k} onClick={() => setFilter(k)}>{dot && <i style={{ background: dot }} />}{label} <b>{counts[k]}</b></button>
              ))}
            </div>
            <div className="card">
              <div className="tw"><table>
                <thead><tr><th>Customer ID</th><th>Business type</th><th>Mobile</th><th>Email</th><th>Plan</th><th>Enrolled via</th></tr></thead>
                <tbody id="rows">
                  {list.length ? list.map((c) => <Row key={c.id} c={c} today={today} onOpen={open} />) : (
                    <tr><td colSpan={6} className="empty">{qq ? `No customer matches “${q}”.` : data ? 'No customers in this group.' : 'Loading…'}</td></tr>
                  )}
                </tbody>
              </table></div>
              <div className="foot"><span id="count">{`Showing ${list.length} of ${all.length} customers`}</span><span>{today && `Today: ${fmt(today)}`}</span></div>
            </div>
          </main>
        </div>
      </div>

      <div className="ov" id="ov" hidden={!cur} onClick={(e) => { if ((e.target as HTMLElement).id === 'ov') close(); }}>
        <aside className="drw" id="drw" role="dialog" aria-modal="true" aria-labelledby="dT">
          {cur && <OwnerDrawer key={cur.id} c={cur} today={today} closeRef={closeRef} onClose={close} onChanged={changed} toast={toast} />}
        </aside>
      </div>
      <div className={toastOn ? 'toast on' : 'toast'} id="toast" role="status">{toastText}</div>
    </>
  );
}

function Row({ c, today, onOpen }: { c: OwnerCustomer; today: string; onOpen: (id: string) => void }) {
  const s = status(c, today);
  const v = VIA[c.via];
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') onOpen(c.id); };
  return (
    <tr tabIndex={0} data-id={c.code} onClick={() => onOpen(c.id)} onKeyDown={onKey}>
      <td><span className="cid">{c.code}</span></td>
      <td>{c.businessType}</td>
      <td>{c.mobile ? mobileOf(c.mobile) : <span style={{ color: 'var(--t2)' }}>—</span>}</td>
      <td>{c.email ? c.email : <span style={{ color: 'var(--t2)' }}>—</span>}</td>
      <td>
        {c.plan === 'paid' && c.paidUntil ? (
          <><span className="plan">{PAID_PLAN}</span> <span className={`st ${s.k}`}>{s.t}</span><small>{s.k === 'susp' ? 'Suspended by you' : daysLeft(c.paidUntil, today) >= 0 ? 'Valid till ' + fmt(c.paidUntil) : 'Ended ' + fmt(c.paidUntil)}</small></>
        ) : (
          <><span className={`st ${s.k}`}>{s.t}</span><small>No plan bought yet</small></>
        )}
      </td>
      <td><span className="via"><OwnerIcon name={v[0] as OwnerIconName} />{v[1]}</span><small>{fmt(c.enrolled)}</small></td>
    </tr>
  );
}
