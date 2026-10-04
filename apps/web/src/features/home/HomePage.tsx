/**
 * Home (#vDash, prototype homeLive / bkDash / exDash): the greeting and hero actions, seven
 * tiles, recent invoices, receivables by age, top selling items, quick actions, cash & bank,
 * this month's GST and low stock. Every figure comes from the books; markup as the prototype.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { MeResponse } from '@billing/shared';
import { api } from '../../lib/api';
import { inr } from '../../lib/format';
import { greeting, today } from '../../lib/time';
import { useFitTables } from '../../lib/useFitTables';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/icon-paths';
import { soon } from '../shell/store';
import { bkCol, bkMask, tint, useAccounts } from '../banking/model';
import { useExpenses } from '../expenses/ExpensesPage';
import type { Item } from '../items/ItemsPage';
import type { Party } from '../parties/PartiesPage';
import type { SaleRow } from '../sales/model';
import type { PurchaseRow } from '../purchases/model';
import { dt } from '../reports/periods';

interface Home {
  today: number; todayBills: number; yesterday: number; gst: { out: number; inp: number }; top: [string, number][]; cashToday: number;
  recent: { id: string; number: string; date: string; due: string; total: number; balance: number; party: string; city: string; items: number; payMode: string }[];
}
interface Chq { dir: 'in' | 'out'; status: string; amount: string }

const STS: Record<string, string> = { Paid: 'g', 'Partly paid': 'b', Due: 'a', Overdue: 'r' };
const pdi = (iso: string) => { const [y, m, d] = iso.split('-').map(Number) as [number, number, number]; return new Date(y, m - 1, d); };
const days = (a: string, b: string) => Math.round((pdi(b).getTime() - pdi(a).getTime()) / 864e5);
const hmLong = (iso: string) => { const d = pdi(iso); return d.getDate() + ' ' + d.toLocaleString('en-IN', { month: 'short' }) + ' ' + d.getFullYear(); };
const hmL = (n: number) => (n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + 'L' : inr(n));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const opt = <T,>(path: string, key: unknown[]) => ({ queryKey: key, queryFn: () => api<T>(path), retry: false });

function Stat({ icon, color, label, value, em, emc, sub, cls = '', view, soonOf, onGo }: { icon: IconName; color: string; label: string; value: string; em: string; emc: string; sub: ReactNode; cls?: string; view?: string; soonOf?: string; onGo: () => void }) {
  return (
    <div className={`card stat ${cls}`} role="button" tabIndex={0} data-view={view} data-soon={soonOf} onClick={onGo} onKeyDown={(e) => { if (e.key === 'Enter') onGo(); }}>
      <div className="ico" style={tint(color)}><Icon name={icon} /></div><small>{label}</small><b>{value}</b><span className="d"><em className={emc}>{em}</em>{sub}</span>
    </div>
  );
}

export function HomePage() {
  useFitTables();
  const me = useOutletContext<MeResponse>();
  const nav = useNavigate();
  const first = (me.user.name || '').trim().split(/\s+/)[0];
  const home = useQuery(opt<Home>(`/reports/home?today=${today()}`, ['home']));
  const parties = useQuery(opt<Party[]>('/parties', ['parties']));
  const sales = useQuery(opt<SaleRow[]>('/sales?kind=invoice', ['sales', 'invoice']));
  const bills = useQuery(opt<PurchaseRow[]>('/purchases?kind=bill', ['purchases', 'bill']));
  const items = useQuery(opt<Item[]>('/items', ['items']));
  const chq = useQuery(opt<Chq[]>('/banking/cheques', ['cheques']));
  const accts = useAccounts();
  const exps = useExpenses();
  const hero = (
    <div className="hero">
      <div><h1>{greeting()}{first ? ', ' + first : ''}</h1></div>
      <div className="acts" id="heroActs">
        <button className="btn" data-soon="Purchases" onClick={() => nav(`/purchases/new?kind=bill&n=${Date.now()}`)}><Icon name="cart" />Add purchase</button>
        <button className="btn" data-soon="Payments" onClick={() => nav('/payments-received?party=')}><Icon name="dn" />Receive payment</button>
        <button className="btn p" data-soon="New invoice" onClick={() => nav(`/sales/new?n=${Date.now()}`)}><Icon name="plus" />New invoice</button>
      </div>
    </div>
  );
  const ready = home.data && parties.data && (sales.data || sales.isError) && (bills.data || bills.isError) && (items.data || items.isError) && (chq.data || chq.isError) && (accts.data || accts.isError) && (exps.data || exps.isError);
  if (!ready) return <section id="vDash">{hero}</section>;

  const T = today(), D = dt(), H = home.data!;
  const S = (sales.data ?? []).filter((s) => !s.cancelled);
  // tiles
  const tv = H.today, yv = H.yesterday;
  const C = parties.data!.filter((p) => p.kind !== 'supplier').map((p) => Number(p.balance)).filter((b) => b > 0), rec = C.reduce((a, b) => a + b, 0);
  const od = S.filter((s) => Number(s.balance) > 0 && s.dueDate && s.dueDate < T).reduce((a, s) => a + Number(s.balance), 0);
  const Sp = parties.data!.filter((p) => p.kind === 'supplier').map((p) => -Number(p.balance)).filter((b) => b > 0), pay = Sp.reduce((a, b) => a + b, 0);
  const wk = (bills.data ?? []).filter((b) => !b.cancelled && Number(b.balance) > 0 && b.dueDate && days(T, b.dueDate) <= 7).reduce((a, b) => a + Number(b.balance), 0);
  const A = accts.data ?? [], banks = A.filter((a) => a.kind === 'bank');
  const cashTot = A.reduce((a, x) => a + Number(x.balance), 0), ct = H.cashToday;
  const net = Math.round((H.gst.out - H.gst.inp) * 100) / 100;
  const nm = new Date(pdi(T).getFullYear(), pdi(T).getMonth() + 1, 20);
  const M = (exps.data ?? []).filter((x) => x.date >= D.mS && x.date <= D.mE), xt = M.reduce((a, x) => a + Number(x.total), 0);
  const byCat = new Map<string, number>();
  M.forEach((x) => byCat.set(x.category, (byCat.get(x.category) ?? 0) + Number(x.total)));
  const topCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0].toLowerCase()).join(', ');
  const st = (items.data ?? []).filter((i) => i.kind === 'goods' && Number(i.minStock) > 0).map((i) => [i, Number(i.stock ?? 0)] as const);
  const low = st.filter((x) => x[1] <= Number(x[0].minStock)), crit = low.filter((x) => x[1] <= 0);
  // recent invoices
  const R = H.recent.map((s) => {
    const paid = Math.round((s.total - s.balance) * 100) / 100, late = s.balance > 0 && s.due && s.due < T ? days(s.due, T) : 0;
    const status = s.balance <= 0 ? 'Paid' : paid > 0 ? 'Partly paid' : late ? 'Overdue' : 'Due';
    return { ...s, paid, status, late: late ? plural(late, 'day late', 'days late') : '', mode: paid > 0 ? s.payMode : 'Credit' };
  });
  // receivables by age
  const ages = [0, 0, 0, 0];
  S.filter((s) => Number(s.balance) > 0).forEach((s) => { const d = days(s.date, T); ages[d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3]! += Number(s.balance); });
  const seg: [number, string, string][] = [[ages[0]!, 'var(--green)', '0–30 days'], [ages[1]!, 'var(--amber)', '31–60 days'], [ages[2]!, 'var(--pink)', '61–90 days'], [ages[3]!, 'var(--red)', '90+ days']];
  const size = 150, sw = 18, r = (size - sw) / 2, Cc = 2 * Math.PI * r, tot = ages.reduce((a, x) => a + x, 0);
  let off = 0;
  const arcs = tot ? seg.flatMap((x, i) => { if (!x[0]) return []; const l = (x[0] / tot) * Cc; const c = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={x[1]} strokeWidth={sw} strokeDasharray={`${Math.max(0, l - 3)} ${Cc - l + 3}`} strokeDashoffset={-off} />; off += l; return [c]; }) : [];
  const ageParties = new Set(S.filter((s) => Number(s.balance) > 0).map((s) => s.party?.id)).size;
  const TP = H.top, tm = TP.length ? TP[0]![1] : 1;
  const LW = low.slice().sort((a, b) => a[1] / (Number(a[0].minStock) || 1) - b[1] / (Number(b[0].minStock) || 1)).slice(0, 4);
  const pc = (chq.data ?? []).filter((c) => c.dir === 'in' && c.status === 'pending');
  const nm2 = new Date(pdi(T).getFullYear(), pdi(T).getMonth() + 1, 1), mon = nm2.toLocaleString('en-IN', { month: 'short' }).toUpperCase();
  const dueLeft = (day: number) => Math.ceil((new Date(nm2.getFullYear(), nm2.getMonth(), day).getTime() - pdi(T).getTime()) / 864e5);
  const QA: [IconName, string, () => void][] = [
    ['receipt', 'Sales invoice', () => nav(`/sales/new?n=${Date.now()}`)], ['cart', 'Purchase bill', () => nav(`/purchases/new?kind=bill&n=${Date.now()}`)], ['wallet', 'Expense', () => nav(`/expenses?new=${Date.now()}`)],
    ['dn', 'Receive payment', () => nav('/payments-received?party=')], ['box', 'Add item', () => soon('Add item')], ['users', 'Add party', () => soon('Add party')],
  ];

  return (
    <section id="vDash">
      {hero}
      <div className="stats" id="stats">
        <Stat icon="receipt" color="--ac" label="Today’s sales" value={inr(tv)} em={yv ? (tv >= yv ? '+' : '') + (((tv - yv) / yv) * 100).toFixed(1) + '%' : plural(H.todayBills, 'bill', 'bills')} emc={tv >= yv ? 'g' : 'r'} sub={yv ? ' vs yesterday' : ' today'} view="sales" onGo={() => nav('/sales')} />
        <Stat icon="up" color="--blue" label="Receivables" value={inr(rec)} em={plural(C.length, 'party', 'parties')} emc="a" sub={od ? ` · ${inr(od)} overdue` : ' · nothing overdue'} view="parties" onGo={() => nav('/parties')} />
        <Stat icon="dn" color="--violet" label="Payables" value={inr(pay)} em={plural(Sp.length, 'supplier', 'suppliers')} emc="b" sub={wk ? ` · ${inr(wk)} due this week` : ' · nothing due this week'} view="parties" onGo={() => nav('/parties')} />
        <Stat icon="wallet" color="--green" label="Cash & bank" value={inr(cashTot)} em={(ct >= 0 ? '+' : '−') + inr(Math.abs(ct))} emc={ct >= 0 ? 'g' : 'r'} sub=" today" soonOf="Banking" onGo={() => nav('/bank-accounts')} />
        <Stat icon="pct" color="--pink" label={'GST payable · ' + D.monName} value={inr(Math.max(0, net))} em={'Due ' + nm.getDate() + ' ' + nm.toLocaleString('en-IN', { month: 'short' })} emc="a" sub={net < 0 ? ` · ${inr(-net)} credit carried` : ' · GSTR-3B'} cls="needs-gst" soonOf="GST" onGo={() => soon('GST')} />
        <Stat icon="wallet" color="--pink" label={'Expenses · ' + D.monName} value={inr(xt)} em={plural(M.length, 'entry', 'entries')} emc="b" sub={topCats || 'nothing yet'} cls="no-gst" view="exp" onGo={() => nav('/expenses')} />
        <Stat icon="alert" color="--red" label="Low stock" value={plural(low.length, 'item', 'items')} em={`${crit.length} out of stock`} emc={crit.length ? 'r' : 'g'} sub=" · at or below reorder level" view="items" onGo={() => nav('/items')} />
      </div>

      <div className="grid">
        <div className="left">
          <section className="card s2">
            <div className="hd"><h3>Recent invoices</h3><button className="lnk" data-soon="Sales" onClick={() => nav('/sales')}>View all sales →</button></div>
            <div className="tw"><table>
              <thead><tr><th>Invoice</th><th>Party</th><th>Date</th><th className="n">Amount</th><th>Status</th></tr></thead>
              <tbody id="inv">{R.length ? R.map((v, i) => (
                <tr tabIndex={0} data-i={i} key={v.id} onClick={() => nav('/sales', { state: { preview: v.id } })} onKeyDown={(e) => { if (e.key === 'Enter') nav('/sales', { state: { preview: v.id } }); }}>
                  <td><b>{v.number}</b><small>{plural(v.items, 'item', 'items')}</small></td>
                  <td><b style={{ fontWeight: 600 }}>{v.party}</b><small>{v.city}</small></td>
                  <td>{hmLong(v.date).split(' ').slice(0, 2).join(' ')}<small>{v.mode}</small></td>
                  <td className="n">{inr(v.total)}{v.status === 'Partly paid' ? <small>{inr(v.total - v.paid)} left</small> : null}</td>
                  <td><span className={`st ${STS[v.status]}`}>{v.status}{v.late ? ' · ' + v.late : ''}</span></td>
                </tr>
              )) : <tr><td colSpan={5} className="ptempty">No invoices yet. Make your first sale with New invoice.</td></tr>}</tbody>
            </table></div>
          </section>

          <section className="card">
            <div className="hd"><h3>Receivables ageing</h3><span className="pill">{ageParties} parties</span></div>
            <div className="flex" id="ageing">
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none' }} role="img" aria-label="Receivables by age"><g transform={`rotate(-90 ${size / 2} ${size / 2})`}><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bd,#e2e8f0)" strokeWidth={sw} />{arcs}</g>
                <text x="50%" y="47%" textAnchor="middle" fill="var(--t1)" fontWeight="800" fontSize="19">{hmL(tot)}</text><text x="50%" y="62%" textAnchor="middle" fill="var(--t2)" fontSize="11">To collect</text></svg>
              <div className="legend">{seg.map((x) => <div key={x[2]}><i style={{ background: x[1] }}></i>{x[2]}<b>{hmL(x[0])}</b></div>)}</div>
            </div>
          </section>

          <section className="card">
            <div className="hd"><h3>Top selling items</h3><span className="pill">This year</span></div>
            <div id="top">{TP.length ? TP.map((t, i) => (
              <div style={{ marginBottom: 13 }} key={t[0]}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t[0]}</span><b>{hmL(t[1])}</b></div><div className="bar"><i style={{ width: `${(t[1] / tm) * 100}%`, background: 'var(--ac)', opacity: 1 - i * 0.14 }}></i></div></div>
            )) : <p className="mu" style={{ fontSize: 13, margin: 0 }}>Sales this year will show here.</p>}</div>
          </section>
        </div>
        <div className="rail">
          <section className="card">
            <div className="hd"><h3>Quick actions</h3></div>
            <div className="qa" id="qa">{QA.map(([ic, t, go]) => <button data-soon={t} key={t} onClick={go}><Icon name={ic} />{t}</button>)}</div>
          </section>

          <section className="card">
            <div className="hd"><h3>Cash &amp; bank</h3><button className="lnk" data-soon="Banking" onClick={() => nav('/bank-accounts')}>Banking →</button></div>
            <b style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em' }}>{inr(cashTot)}</b>
            <small style={{ display: 'block', color: 'var(--t2)', marginBottom: 14 }}>Total across {plural(A.length, 'account', 'accounts')}</small>
            <div id="bank">
              {A.map((a) => (
                <a href="#" className="row" data-view={a.kind === 'cash' ? 'cash' : 'bks'} data-bksel={a.kind === 'bank' ? a.id : undefined} style={{ textDecoration: 'none', color: 'inherit' }} key={a.id} onClick={(e) => { e.preventDefault(); nav(a.kind === 'cash' ? '/cash-in-hand' : `/bank-accounts?sel=${a.id}`); }}>
                  <div className="ico" style={tint(bkCol(a, banks))}><Icon name={a.kind === 'cash' ? 'cash' : 'bank'} /></div><div><b>{a.name}</b><small>{a.kind === 'cash' ? a.sub || 'Shop counter' : (a.sub || '') + (a.accountNo ? ' ' + bkMask(a.accountNo) : '')}</small></div><div className="v">{inr(Number(a.balance))}</div>
                </a>
              ))}
              {pc.length ? <a href="#" className="row" data-view="chq" style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => { e.preventDefault(); nav('/cheques'); }}><div className="ico" style={tint('--amber')}><Icon name="doc" /></div><div><b>Cheques to deposit</b><small>{pc.length} pending</small></div><div className="v">{inr(pc.reduce((s, c) => s + Number(c.amount), 0))}</div></a> : null}
            </div>
          </section>

          <section className="card needs-gst">
            <div className="hd"><h3>GST · {D.monName}</h3><button className="lnk" data-soon="GST" onClick={() => soon('GST')}>GST reports →</button></div>
            <div className="gst">
              <div><span>Output tax</span><b>{inr(H.gst.out)}</b></div>
              <div><span>Input credit</span><b>{inr(H.gst.inp)}</b></div>
              <div className="tot"><span>{net < 0 ? 'Credit carried forward' : 'Net GST payable'}</span><b>{inr(net)}</b></div>
            </div>
            <div className="due"><div className="dt">11<small>{mon}</small></div><div><b>GSTR-1</b><small>Outward supplies</small></div><span className="st a">{plural(dueLeft(11), 'day left', 'days left')}</span></div>
            <div className="due"><div className="dt">20<small>{mon}</small></div><div><b>GSTR-3B</b><small>Summary return + payment</small></div><span className="st b">{plural(dueLeft(20), 'day left', 'days left')}</span></div>
          </section>

          <section className="card">
            <div className="hd"><h3>Low stock</h3><span className="st r">{plural(low.length, 'item', 'items')}</span></div>
            <div id="low">{LW.length ? LW.map(([i, q]) => {
              const m = Number(i.minStock) || 1, p = Math.max(0, Math.min(100, (q / m) * 100)), c = p < 30 ? 'var(--red)' : 'var(--amber)';
              return <div className="row" style={{ display: 'block' }} key={i.id}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><b>{i.name}</b><span style={{ fontSize: 12.5, fontWeight: 700, color: c, whiteSpace: 'nowrap' }}>{q} {i.unit || ''}</span></div><small>Reorder at {m} {i.unit || ''}</small><div className="bar"><i style={{ width: `${p}%`, background: c }}></i></div></div>;
            }) : <p className="mu" style={{ fontSize: 13, margin: 0 }}>All items are above their reorder level.</p>}</div>
            <button className="lnk" data-soon="Items & stock" style={{ marginTop: 10 }} onClick={() => soon('Items & stock')}>View stock report →</button>
          </section>
        </div>
      </div>
    </section>
  );
}
