/** <header class="top"> — the prototype's top bar, without Quick sale, colours and sync (moved to Settings › General). */
import { Fragment, type MouseEvent as RMouseEvent, type ReactNode } from 'react';
import { ROLE_LABELS, daysBetween, formatInr2, formatLongDate, type MeResponse } from '@billing/shared';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell, type PopId } from './store';

const KEYS = '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>';
const PROFILE = '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>';
const LICENSE = '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h4M14 14h3"/>';
const LOCK = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const OUT = '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>';

/** Sync status labels (prototype LBL). The rebuild saves to the server, so "ok" when online. */
export const SYNC_LABEL = {
  ok: 'Synced — the same books on every device and for all your staff',
  off: 'Offline — changes are saved here and will sync when back online',
} as const;

const QC: Array<[icon: 'receipt' | 'doc' | 'swap' | 'cart' | 'wallet' | 'users' | 'box', label: string, kbd?: string]> = [
  ['receipt', 'Invoice', 'Alt+S'], ['doc', 'Quotation', 'Alt+Q'], ['swap', 'Payment received', 'Alt+R'], ['cart', 'Purchase bill', 'Alt+P'],
  ['wallet', 'Expense', 'Alt+X'], ['swap', 'Payment made'], ['users', 'Customer', 'Alt+A'], ['box', 'Item', 'Alt+I'],
];

const initial = (s: string) => (s.trim()[0] ?? 'B').toUpperCase();

export interface BellItem {
  key: string;
  node: ReactNode;
}

/** Notifications: the plan notice, then GST due dates (more are added as screens are rebuilt). */
/** Overdue documents for the bell, newest first (prototype allBills / allSales order). */
export interface Overdue { bills: { number: string; balance: string }[]; sales: { balance: string }[] }

export function bellItems(me: MeResponse, today: string, onView: (v: string) => void, lowItems = 0, od: Overdue = { bills: [], sales: [] }): BellItem[] {
  const b = me.business!;
  const items: BellItem[] = [];
  if (b.plan === 'trial') {
    const left = Math.max(0, daysBetween(today, b.planEndsOn));
    items.push({
      key: 'sub',
      node: (
        <div className="bni sub trial">
          <Icon name="clock" />
          <span><b>Free trial: {left} days left.</b> All features are open until {formatLongDate(b.planEndsOn)}.</span>
          <button className="lnk2" data-view="sub" onClick={() => onView('sub')}>Choose a plan</button>
        </div>
      ),
    });
  } else if (b.plan === 'expired') {
    items.push({
      key: 'sub',
      node: (
        <div className="bni sub ended">
          <Icon name="lock" />
          <span><b>Your free trial has ended.</b> You can view your records, but can’t add new ones.</span>
          <button className="lnk2" data-view="sub" onClick={() => onView('sub')}>Choose a plan</button>
        </div>
      ),
    });
  }
  if (od.bills.length) {
    const n = od.bills.length, amt = od.bills.reduce((a, b) => a + Number(b.balance), 0);
    items.push({
      key: 'pur',
      node: (
        <button className="bni" data-view="pur" onClick={() => onView('pur')}>
          <Icon name="alert" />
          <span><b>{n} purchase bill{n > 1 ? 's' : ''} overdue</b><small>₹{formatInr2(amt.toFixed(2))} to pay · oldest {od.bills[n - 1]!.number}</small></span>
        </button>
      ),
    });
  }
  if (od.sales.length) {
    const n = od.sales.length, amt = od.sales.reduce((a, b) => a + Number(b.balance), 0);
    items.push({
      key: 'sales',
      node: (
        <button className="bni" data-view="sales" onClick={() => onView('sales')}>
          <Icon name="receipt" />
          <span><b>{n} sales invoice{n > 1 ? 's' : ''} overdue</b><small>₹{formatInr2(amt.toFixed(2))} to collect</small></span>
        </button>
      ),
    });
  }
  if (lowItems) {
    items.push({
      key: 'low',
      node: (
        <button className="bni" data-view="items" onClick={() => onView('items')}>
          <Icon name="box" />
          <span><b>{lowItems} items low on stock</b><small>Below their minimum level</small></span>
        </button>
      ),
    });
  }
  if (b.gstEnabled) {
    const [y, m] = today.split('-').map(Number) as [number, number];
    const nm = new Date(y, m, 1).toLocaleString('en-IN', { month: 'short' });
    items.push({
      key: 'gst',
      node: (
        <div className="bni">
          <Icon name="pct" />
          <span><b>GSTR-1 due on 11 {nm}</b><small>GSTR-3B due on 20 {nm}</small></span>
        </div>
      ),
    });
  }
  return items;
}

interface Props {
  me: MeResponse;
  today: string;
  /** goods below their minimum or out of stock (bell) */
  lowItems?: number;
  overdue?: Overdue;
  online: boolean;
  onView: (v: string) => void;
  onSoon: (what: string) => void;
  onSwitch: (businessId: string) => void;
  onAddBusiness: () => void;
  onSignOut: () => void;
  onSearch: (q: string) => void;
}

export function TopBar({ me, today, lowItems = 0, overdue, online, onView, onSoon, onSwitch, onAddBusiness, onSignOut, onSearch }: Props) {
  const { pop, setPop, sideOpen, setSideOpen } = useShell();
  const b = me.business!;
  const toggle = (p: PopId) => (e: RMouseEvent) => {
    e.stopPropagation();
    setPop(pop === p ? null : p);
  };
  const bell = bellItems(me, today, (v) => { setPop(null); onView(v); }, lowItems, overdue);
  const n = bell.length;
  const left = Math.max(0, daysBetween(today, b.planEndsOn));
  const lic = b.plan === 'trial' ? `Free trial · ${left} days left` : b.plan === 'expired' ? 'Trial ended · choose a plan' : `Paid · till ${formatLongDate(b.planEndsOn)}`;
  const others = me.memberships.filter((m) => m.businessId !== b.id);
  const ownerName = me.user.name || b.name;

  return (
    <header className="top">
      <button className="ib menu" id="menuBtn" aria-label="Open menu" onClick={(e) => { e.stopPropagation(); setSideOpen(!sideOpen); }}><Icon name="menu" /></button>
      <label className="search" htmlFor="q">
        <span id="qi"><Icon name="search" /></span>
        <input id="q" placeholder="Search invoice, party, item…" autoComplete="off" onKeyDown={(e) => { const v = e.currentTarget.value.trim(); if (e.key === 'Enter' && v) onSearch(v); }} />
      </label>
      <div className="sp"></div>
      {/* owner's change: Quick sale (Alt+N), colour combination and sync moved to Settings › General; only an Offline label shows here, and only while offline */}
      {online ? null : <span className="st r" id="offChip" role="status" title={SYNC_LABEL.off}>Offline</span>}
      <div className="rel" hidden style={{ display: 'none' }}>
        <button className="ib plus" id="qcBtn" aria-label="Create new" aria-haspopup="true" aria-expanded={pop === 'qcPop'} onClick={toggle('qcPop')}><Icon name="plus" /></button>
        <div className="pop qc" id="qcPop" hidden={pop !== 'qcPop'}>
          <h4 style={{ gridColumn: '1/-1' }}>Create new</h4>
          {QC.map(([ic, label, kbd]) => (
            <button key={label} data-soon={`New ${label.toLowerCase()}`} onClick={() => onSoon(`New ${label.toLowerCase()}`)}><Icon name={ic} />{label}{kbd && <kbd className="kh">{kbd}</kbd>}</button>
          ))}
        </div>
      </div>
      <button className="ib" id="ksBtn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => onSoon('Keyboard shortcuts')}><RawIcon d={KEYS} /></button>
      <div className="rel">
        <button className="ib" id="bellBtn" aria-label={`Notifications (${n})`} aria-haspopup="true" aria-expanded={pop === 'bellPop'} onClick={toggle('bellPop')}>
          <Icon name="bell" /><span className="dot" hidden></span><span className="bcnt" id="bellCnt" hidden={!n}>{n > 9 ? '9+' : n}</span>
        </button>
        <div className="pop bellp" id="bellPop" hidden={pop !== 'bellPop'} role="dialog" aria-label="Notifications">
          <div className="bph"><b>Notifications</b><small>{n}</small></div>
          {bell.map((x) => <Fragment key={x.key}>{x.node}</Fragment>)}
        </div>
      </div>
      <div className="rel">
        <button className="org" id="orgBtn" aria-haspopup="true" aria-expanded={pop === 'orgPop'} onClick={toggle('orgPop')}>
          <span className="on2" id="orgName">{b.short || b.name}</span><span id="orgCh"><Icon name="chev" /></span>
        </button>
        <div className="pop" id="orgPop" hidden={pop !== 'orgPop'}>
          <h4>Your businesses</h4>
          <button className="cur" onClick={() => setPop(null)}>
            <span className="logo" style={{ width: 28, height: 28, fontSize: 12 }}>{initial(b.name)}</span>
            <span><b>{b.name}</b><small className="needs-gst" id="bizGst" hidden={!b.gstin}>{b.gstin ? 'GSTIN ' + b.gstin : ''}</small></span>
          </button>
          {others.map((m) => (
            <button key={m.businessId} onClick={() => { setPop(null); onSwitch(m.businessId); }}>
              <span className="logo" style={{ width: 28, height: 28, fontSize: 12, background: '#c2410c' }}>{initial(m.businessName)}</span>
              <span><b>{m.businessName}</b><small>{m.city}</small></span>
            </button>
          ))}
          <button onClick={() => { setPop(null); onAddBusiness(); }}><span id="orgAdd"><Icon name="plus" /></span>Add a business</button>
        </div>
      </div>
      <div className="rel">
        <button className="avb" id="avBtn" aria-label="Account menu" aria-haspopup="true" aria-expanded={pop === 'avPop'} onClick={toggle('avPop')}>
          <span className="av">{initial(ownerName)}</span>
        </button>
        <div className="pop avp" id="avPop" hidden={pop !== 'avPop'} role="menu">
          <div className="avh">
            <span className="av" style={{ width: 42, height: 42, fontSize: 16 }}>{initial(ownerName)}</span>
            <div><b>{me.user.name || me.user.email}</b><small>{me.user.email}</small><span className="st g" style={{ marginTop: 4 }}>{me.role ? ROLE_LABELS[me.role] : ''} · {b.code}</span></div>
          </div>
          <button role="menuitem" id="miProfile" onClick={() => { setPop(null); onSoon('My profile'); }}><RawIcon d={PROFILE} /><span>My profile<small>Name, mobile, email, password</small></span></button>
          <button role="menuitem" id="miLicense" onClick={() => { setPop(null); onView('sub'); }}><RawIcon d={LICENSE} /><span>License<small id="miLicSub">{lic}</small></span></button>
          <button role="menuitem" id="miKeys" onClick={() => { setPop(null); onSoon('Keyboard shortcuts'); }}><RawIcon d={KEYS} /><span>Keyboard shortcuts<small>Press ?</small></span></button>
          <button role="menuitem" id="miLock" onClick={() => { setPop(null); onSoon('Lock screen'); }}><RawIcon d={LOCK} /><span>Lock screen<small>Ctrl + Shift + L</small></span></button>
          <div className="avsep"></div>
          <button role="menuitem" id="miOut" className="out" onClick={() => { setPop(null); onSignOut(); }}><RawIcon d={OUT} /><span>Sign out</span></button>
        </div>
      </div>
    </header>
  );
}
