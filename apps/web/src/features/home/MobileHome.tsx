/**
 * Home on a phone (owner's request, 6 Nov 2026), drawn after the owner's approved Classic mocks (home, create-sheet,
 * side-menu): the shop's name and plan, the You'll Get / You'll Give card, Parties / Transactions / Items, and a bar
 * that always stays at the bottom: Take Payment, + (the "Create new" sheet) and Add Sale. The menu button opens the
 * side menu. Everything shown is the shop's own data.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, daysBetween, type MeResponse } from '@billing/shared';
import { api } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { RawIcon } from '../../components/Icon';
import { useStyles } from '../../lib/useStyles';
import { useFullscreen } from '../shell/EntryFrame';
import { useShell } from '../shell/store';
import { useEditorData } from '../sales/editor/data';
import { useSales } from '../sales/model';
import { useQuick } from '../sales/QuickSale';
import { AddPartyDialog } from '../parties/AddPartyDialog';
import { useBackup } from '../settings/BackupCard';
import css from './mobile-home.css?inline';

const I = {
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sort: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pay: '<path d="M12 3v10M8 9l4 4 4-4M5 17h14M5 21h14"/>',
  doc: '<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h5"/>',
  box: '<path d="M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
  rupee: '<path d="M7 5h10M7 9h10M7 5c4 0 5 2 5 4s-2 4-5 4h-1l7 6"/>',
  open: '<path d="M6 9l6 6 6-6"/>',
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const longDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d} ${MON[Number(m) - 1] ?? ''} ${y}`; };
export const initials = (n: string) => n.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w[0] ?? '')).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
/** rupees and paise apart, as the mock shows the big amounts */
const split = (n: number) => { const [r, p] = inr2f(n).split('.'); return <>₹{r}<small>.{p}</small></>; };
export const amt = (n: number) => (Math.round(n * 100) % 100 ? inr2f(n) : inr2f(n).replace(/\.00$/, ''));

type Tab = 'parties' | 'txns' | 'items';

export function MobileHome() {
  useStyles([css], 'mobile-home');
  useFullscreen();
  const me = useOutletContext<MeResponse>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useShell();
  const d = useEditorData();
  const sales = useSales('invoice');
  const [tab, setTab] = useState<Tab>('parties');
  const [q, setQ] = useState('');
  const [byName, setByName] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [addParty, setAddParty] = useState(false);
  const b = me.business!;
  const left = daysBetween(today(), b.planEndsOn);
  const sub = b.plan === 'trial' ? `Trial · ${Math.max(0, left)} day${left === 1 ? '' : 's'} left` : b.plan === 'expired' ? 'Plan ended' : b.city || 'Paid plan';

  // under each party: the date of its latest sale, purchase, payment, note or bounce (owner, 6 Nov 2026), worked out
  // by the All parties report; people who can't see reports, and parties with no entries yet, get the phone number
  const lastQ = useQuery({ queryKey: ['reports', 'all-parties'], queryFn: () => api<{ id: string; last: string }[]>('/reports/all-parties'), enabled: can(me.permissions, 'reports.view'), retry: false });
  const last = useMemo(() => new Map((lastQ.data ?? []).map((p) => [p.id, p.last])), [lastQ.data]);
  const PT = d?.PT ?? [];
  const get = PT.filter((p) => p.balance > 0), give = PT.filter((p) => p.balance < 0);
  const sum = (L: typeof PT) => L.reduce((a, p) => a + Math.abs(p.balance), 0);
  const s = q.trim().toLowerCase();
  const parties = useMemo(() => PT.filter((p) => !s || p.name.toLowerCase().includes(s) || p.phone.includes(s))
    .sort((a, c) => (byName ? a.name.localeCompare(c.name) : Math.abs(c.balance) - Math.abs(a.balance))), [PT, s, byName]);
  const txns = (sales.data ?? []).filter((x) => !x.cancelled && (!s || x.partyName.toLowerCase().includes(s) || x.number.toLowerCase().includes(s))).slice(0, 50);
  const items = (d?.IT ?? []).filter((x) => !s || x.name.toLowerCase().includes(s) || x.code.toLowerCase().includes(s)).sort((a, c) => (byName ? a.name.localeCompare(c.name) : (c.stock ?? 0) - (a.stock ?? 0)));
  const soon = (w: string) => showToast(`${w} is coming to the phone next`);

  return (
    <section className="mh" id="vHomeM">
      <header className="mh-top">
        <button type="button" className="mh-ib" id="mhMenu" aria-label="Open menu" onClick={() => setMenu(true)}><RawIcon d={I.menu} /></button>
        <div className="mh-tt"><b>{b.name}</b><small>{sub}</small></div>
        <button type="button" className="mh-ib g" aria-label="Notifications" onClick={() => soon('Notifications')}><RawIcon d={I.bell} /></button>
        <button type="button" className="mh-ib g" aria-label="Share" onClick={() => { if (navigator.share) navigator.share({ text: b.name }).catch(() => undefined); else soon('Sharing'); }}><RawIcon d={I.share} /></button>
      </header>

      <section className="mh-head">
        <div className="mh-sum">
          <div><span className="mh-sl"><i className="g"><RawIcon d={I.down} /></i>You’ll Get</span><b>{split(sum(get))}</b><small>from {get.length} part{get.length === 1 ? 'y' : 'ies'}</small></div>
          <div><span className="mh-sl"><i className="r"><RawIcon d={I.up} /></i>You’ll Give</span><b>{split(sum(give))}</b><small>to {give.length} part{give.length === 1 ? 'y' : 'ies'}</small></div>
        </div>
        <div className="mh-tabs" role="tablist" aria-label="Home view">
          {([['parties', 'Parties'], ['txns', 'Transactions'], ['items', 'Items']] as const).map(([k, l]) => (
            <button type="button" role="tab" aria-selected={tab === k} key={k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="mh-find">
          <label><RawIcon d={I.search} /><input type="search" id="mhSearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'parties' ? 'Search party' : tab === 'txns' ? 'Search bill or party' : 'Search item'} aria-label="Search" /></label>
          <button type="button" className="mh-ib g" aria-label={byName ? 'Sort by amount' : 'Sort by name'} aria-pressed={byName} onClick={() => setByName(!byName)}><RawIcon d={I.sort} /></button>
          {tab === 'parties' ? <button type="button" className="mh-new" id="mhNewParty" onClick={() => setAddParty(true)}><RawIcon d={I.plus} />New Party</button>
            : tab === 'items' ? <button type="button" className="mh-new" onClick={() => nav('/items')}><RawIcon d={I.plus} />New Item</button> : null}
        </div>
      </section>

      <ul className="mh-list" aria-label={tab === 'parties' ? 'Parties' : tab === 'txns' ? 'Transactions' : 'Items'}>
        {tab === 'parties' && parties.map((p, i) => (
          <li key={p.id}><button type="button" onClick={() => nav(`/parties?sel=${p.id}`)}>
            <span className={`mh-av t${i % 5}`} aria-hidden="true">{initials(p.name)}</span>
            <span className="mh-mid"><b>{p.name}</b><small>{last.get(p.id) ? longDate(last.get(p.id)!) : p.phone ? '+91 ' + p.phone : p.supplier ? 'Supplier' : 'Customer'}</small></span>
            {p.balance ? <span className={`mh-amt ${p.balance > 0 ? 'get' : 'give'}`}><b>₹{amt(Math.abs(p.balance))}</b><small>{p.balance > 0 ? 'You’ll Get' : 'You’ll Give'}</small></span> : <span className="mh-amt"><b>₹0</b><small>Settled</small></span>}
          </button></li>
        ))}
        {tab === 'txns' && txns.map((x) => (
          <li key={x.id}><button type="button" onClick={() => nav('/sales', { state: { preview: x.id } })}>
            <span className="mh-av t0" aria-hidden="true"><RawIcon d={I.doc} /></span>
            <span className="mh-mid"><b>{x.partyName || 'Cash sale'}</b><small>Sale {x.number} · {longDate(x.date)}</small></span>
            <span className={`mh-amt ${Number(x.balance) > 0 ? 'give' : 'get'}`}><b>₹{amt(Number(x.total))}</b><small>{Number(x.balance) > 0 ? `Due ₹${amt(Number(x.balance))}` : 'Paid'}</small></span>
          </button></li>
        ))}
        {tab === 'items' && items.map((it, i) => (
          <li key={it.id}><button type="button" onClick={() => nav('/items')}>
            <span className={`mh-av t${(i + 2) % 5}`} aria-hidden="true"><RawIcon d={I.box} /></span>
            <span className="mh-mid"><b>{it.name}</b><small>{it.svc ? 'Service' : `Stock ${it.stock ?? 0} ${it.unit}`}</small></span>
            <span className="mh-amt"><b>₹{amt(it.sale)}</b><small>Sale price</small></span>
          </button></li>
        ))}
        {((tab === 'parties' && !parties.length) || (tab === 'txns' && !txns.length) || (tab === 'items' && !items.length)) && <li className="mh-none">{s ? 'Nothing matches the search.' : tab === 'parties' ? 'No parties yet. Tap New Party.' : tab === 'txns' ? 'No bills yet. Tap Add Sale.' : 'No items yet.'}</li>}
      </ul>

      <div className="mh-bar">
        <button type="button" className="mh-pay" id="mhTakePay" onClick={() => nav('/payments-received?party=')}><RawIcon d={I.rupee} />Take Payment</button>
        <button type="button" className="mh-plus" id="mhPlus" aria-label="Create new transaction" aria-expanded={sheet} onClick={() => setSheet(true)}><RawIcon d={I.plus} /></button>
        <button type="button" className="mh-sale" id="mhAddSale" onClick={() => nav(`/sales/new?n=${Date.now()}`)}><RawIcon d={I.doc} />Add Sale</button>
      </div>

      {sheet && <CreateSheet onClose={() => setSheet(false)} go={(to) => { setSheet(false); to(); }} nav={nav} soon={soon} />}
      {menu && <SideMenu me={me} onClose={() => setMenu(false)} nav={(to) => { setMenu(false); nav(to); }} soon={soon} />}
      <AddPartyDialog open={addParty} onClose={() => setAddParty(false)} onSaved={() => { setAddParty(false); void qc.invalidateQueries({ queryKey: ['parties'] }); showToast('Party added'); }} />
    </section>
  );
}

/* ───────── "Create new" (the + button; mock create-sheet) ───────── */
type Tile = [label: string, icon: string, run: () => void];
function CreateSheet({ onClose, go, nav, soon }: { onClose: () => void; go: (to: () => void) => void; nav: (to: string) => void; soon: (w: string) => void }) {
  const n = () => Date.now();
  const sale: Tile[] = [
    ['Sale Invoice', I.doc, () => nav(`/sales/new?n=${n()}`)],
    ['Payment In', I.pay, () => nav('/payments-received?party=')],
    ['Sale Return', '<path d="M9 7H5V3M5 7a8 8 0 1 1-1 7"/>', () => nav('/credit-notes')],
    ['Sale Order', '<path d="M8 4h8v3H8zM6 5H5v16h14V5h-1M9 12l2 2 4-4"/>', () => soon('Sale order')],
    ['Estimate', '<path d="M6 3h9l4 4v14H6zM10 11h5M10 15h3M12.5 8v6"/>', () => nav(`/sales/new?quote=1&n=${n()}`)],
    ['Delivery Challan', '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1"/>', () => nav('/delivery-challans?new=1')],
    ['Quick POS', '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM13 7l-3 5h4l-3 5"/>', () => useQuick.getState().show()],
  ];
  const buy: Tile[] = [
    ['Purchase Bill', '<path d="M3 4h2l2.5 11h11L21 7H6.5M9 20a1 1 0 1 0 0-.1M18 20a1 1 0 1 0 0-.1"/>', () => nav(`/purchases/new?kind=bill&n=${n()}`)],
    ['Payment Out', '<path d="M12 13V3M8 7l4-4 4 4M5 17h14M5 21h14"/>', () => nav('/payments-made?new=1')],
    ['Purchase Return', '<path d="M15 7h4V3M19 7a8 8 0 1 0 1 7"/>', () => nav(`/purchases/new?kind=debit&n=${n()}`)],
    ['Purchase Order', '<path d="M8 4h8v3H8zM6 5H5v16h14V5h-1M12 11v6M9 14l3 3 3-3"/>', () => nav(`/purchases/new?kind=order&n=${n()}`)],
  ];
  const other: Tile[] = [
    ['Expense', '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V5a2 2 0 0 1 2-2h10v4M16 13h1"/>', () => nav(`/expenses?new=${n()}`)],
    ['Party Transfer', I.swap, () => soon('Party transfer')],
  ];
  const grid = (h: string, L: Tile[], cls: string) => (
    <><h2>{h}</h2><div className="mh-grid">{L.map(([l, ic, run]) => <button type="button" key={l} onClick={() => go(run)}><span className={cls}><RawIcon d={ic} /></span>{l}</button>)}</div></>
  );
  return (
    <div className="mh-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="mh-sheet" role="dialog" aria-modal="true" aria-label="Create new">
        <span className="mh-grab" aria-hidden="true"></span>
        <div className="mh-sh"><div><h1>Create new</h1><span>Pick what you want to record</span></div><button type="button" className="mh-ib g" aria-label="Close" onClick={onClose}><RawIcon d={I.x} /></button></div>
        {grid('Sale', sale, 'sl')}{grid('Purchase', buy, 'pu')}{grid('Other', other, 'ot')}
      </section>
    </div>
  );
}

/* ───────── side menu (mock side-menu) ───────── */
type Row = [label: string, icon: string, to?: string, subs?: [string, string][]];
const MENU: Row[] = [
  ['Home', '<path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z"/>', '/'],
  ['Parties', '<path d="M9 11a3.5 3.5 0 1 0 0-.1M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c2 .6 3.3 2.5 3.5 5.5"/>', '/parties'],
  ['Items', I.box, '/items'],
  ['Reports', '<path d="M4 20V4M4 20h16M8 16l4-5 3 3 5-6"/>', '/reports'],
  ['Sale', I.doc, undefined, [['Sale invoices', '/sales'], ['Estimates / quotations', '/quotations'], ['Payments received', '/payments-received'], ['Sale returns', '/credit-notes'], ['Delivery challans', '/delivery-challans']]],
  ['Purchase', '<path d="M3 4h2l2.5 11h11L21 7H6.5M9 20a1 1 0 1 0 0-.1M18 20a1 1 0 1 0 0-.1"/>', undefined, [['Purchase bills', '/purchase-bills'], ['Purchase orders', '/purchase-orders'], ['Payments made', '/payments-made'], ['Purchase returns', '/debit-notes']]],
  ['Expense', '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V5a2 2 0 0 1 2-2h10v4M16 13h1"/>', '/expenses'],
  ['Cash & Bank', '<path d="M3 9l9-5 9 5M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>', undefined, [['Bank accounts', '/bank-accounts'], ['Cash in hand', '/cash-in-hand'], ['Cheques', '/cheques']]],
  ['Settings', '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>', '/settings'],
  ['Backup & Restore', '<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2"/>', '/settings'],
];
function SideMenu({ me, onClose, nav, soon }: { me: MeResponse; onClose: () => void; nav: (to: string) => void; soon: (w: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const b = me.business!;
  // the real backup status (owner, 6 Nov 2026): on when Google Drive or this computer's folder is switched on
  const bk = useBackup().data;
  const bkOn = !!(bk?.drive?.enabled || bk?.local?.enabled);
  return (
    <div className="mh-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <nav className="mh-menu" aria-label="Main menu">
        <div className="mh-mh">
          <div className="mh-org"><span aria-hidden="true">{initials(b.name)}</span><div><b>{b.name}</b><small>{me.user.email}</small></div></div>
          <button type="button" className="mh-chg" onClick={() => soon('Change company')}>Change company<RawIcon d={I.chev} /></button>
        </div>
        <ul>
          {MENU.map(([l, ic, to, subs]) => (
            <li key={l}>
              <button type="button" className={to === '/' ? 'on' : ''} aria-expanded={subs ? open === l : undefined} onClick={() => (subs ? setOpen(open === l ? null : l) : nav(to!))}>
                <RawIcon d={ic} /><span>{l}{l === 'Backup & Restore' && bk ? <small className={bkOn ? 'on' : ''}>Auto backup is {bkOn ? 'on' : 'off'}</small> : null}</span>{subs ? <RawIcon d={I.open} /> : null}
              </button>
              {subs && open === l ? <div className="mh-subs">{subs.map(([sl, st]) => <button type="button" key={st} onClick={() => nav(st)}>{sl}</button>)}</div> : null}
            </li>
          ))}
        </ul>
        {b.plan !== 'paid' ? <div className="mh-plan"><div><b>{b.plan === 'trial' ? 'Trial plan' : 'Plan ended'}</b><small>{b.plan === 'trial' ? 'Expires on' : 'Ended on'} {longDate(b.planEndsOn)}</small></div><button type="button" onClick={() => soon('Upgrade')}>Upgrade</button></div> : null}
      </nav>
    </div>
  );
}
