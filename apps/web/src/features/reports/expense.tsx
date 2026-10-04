/** Expense reports (prototype RPT.expl / expc / expi), from the same list as the Expenses page. */
import { useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { useAccounts } from '../banking/model';
import { useExpenses, type ExpenseRow } from '../expenses/ExpensesPage';
import { dmyOf, range } from './periods';
import { RpShell, Sel, type RpDef } from './Shell';
import type { RpProps } from './ReportsPage';

const r2 = (v: number) => Math.round(v * 100) / 100;
const rpN = (v: number) => (v ? inr2f(v) : '—');
/* remembered while the app is open, as in the prototype (RPF.exCat / exAcct) */
const RPF = { exCat: 'all', exAcct: 'all' };
const useCats = () => useQuery({ queryKey: ['expense-categories'], queryFn: () => api<{ id: string; name: string }[]>('/expense-categories') });

function useRows(p: RpProps['p']) {
  const all = useExpenses();
  const [f, t] = range(p);
  return all.data ? all.data.filter((x) => x.date >= f && x.date <= t) : null;
}
/** A row opens the expense, or the cash / bank book entry (prototype xpOpen / bkView). */
function useOpen() {
  const nav = useNavigate();
  return (k: string) => nav('/expenses', { state: { open: k } });
}

function Expl(props: RpProps) {
  const A0 = useRows(props.p);
  const cats = useCats(), accts = useAccounts();
  const [cat, setCatS] = useState(RPF.exCat), [acct, setAcctS] = useState(RPF.exAcct);
  const open = useOpen();
  if (!A0 || !cats.data || !accts.data) return null;
  const setCat = (v: string) => { RPF.exCat = v; setCatS(v); }, setAcct = (v: string) => { RPF.exAcct = v; setAcctS(v); };
  const aName = (id: string | null) => accts.data.find((a) => a.id === id)?.name ?? '—';
  const A = A0.filter((x) => (cat === 'all' || x.category === cat) && (acct === 'all' || x.accountId === acct));
  const tot = r2(A.reduce((a, x) => a + Number(x.total), 0)), g = r2(A.reduce((a, x) => a + Number(x.gst), 0));
  const def: RpDef = {
    title: 'Expense', group: 'Expense report', sub: cat === 'all' ? '' : cat,
    filters: <><Sel id="rpXc" label="Category" opts={[['all', 'All categories'], ...cats.data.map((c) => [c.name, c.name] as [string, string])]} value={cat} onChange={setCat} />
      <Sel id="rpXa" label="Paid from" opts={[['all', 'Any account'], ...accts.data.map((a) => [a.id, a.name] as [string, string])]} value={acct} onChange={setAcct} /></>,
    kpis: [['Total spent', inr2f(tot), 'pscl neg'], ['Entries', String(A.length)], ['GST input credit', inr2f(g)], ['Average entry', inr2f(A.length ? tot / A.length : 0)]],
    cols: [{ h: 'Date', w: 11 }, { h: 'Exp. no.', w: 11 }, { h: 'Category', w: 18 }, { h: 'Paid to', w: 24 }, { h: 'Paid from', w: 18 }, { h: 'Mode', w: 12 }, { h: 'GST', n: true }, { h: 'Amount', n: true }],
    rows: A.map((x) => ({ k: x.key, c: [dmyOf(x.date), x.number, x.category, x.payee || '', aName(x.accountId), x.mode || '', rpN(Number(x.gst)), inr2f(Number(x.total))] })),
    foot: ['Total', '', '', '', '', '', rpN(g), inr2f(tot)], empty: 'No expenses in this period.',
    note: 'Includes expenses entered on the Expenses page and money taken out of the cash or bank book for shop expenses, salary and bank charges. Click a row to open it.',
    click: open,
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}

function Expc(props: RpProps) {
  const A = useRows(props.p);
  const accts = useAccounts();
  if (!A || !accts.data) return null;
  const cashId = accts.data.find((a) => a.kind === 'cash')?.id;
  const by = new Map<string, { n: number; t: number; g: number; cash: number; bank: number }>();
  A.forEach((x) => { const o = by.get(x.category) ?? { n: 0, t: 0, g: 0, cash: 0, bank: 0 }; const v = Number(x.total); o.n++; o.t += v; o.g += Number(x.gst); if (x.accountId === cashId) o.cash += v; else o.bank += v; by.set(x.category, o); });
  const R = [...by.entries()].sort((a, b) => b[1].t - a[1].t), tot = r2(A.reduce((a, x) => a + Number(x.total), 0));
  const T = (k: 'cash' | 'bank' | 'g') => r2(R.reduce((a, [, o]) => a + o[k], 0));
  const pc = (t: number) => (tot ? (t / tot) * 100 : 0);
  const def: RpDef = {
    title: 'Expense Category Report', group: 'Expense report',
    kpis: [['Total spent', inr2f(tot), 'pscl neg'], ['Categories used', String(R.length)], ['Biggest', R.length ? R[0]![0] : '—', '', R.length && tot ? Math.round((R[0]![1].t / tot) * 100) + '% of spending' : ''], ['Paid in cash', inr2f(T('cash'))]],
    cols: [{ h: 'Category', w: 24 }, { h: 'Entries', n: true, int: true, w: 9 }, { h: 'Cash', n: true }, { h: 'Bank & UPI', n: true }, { h: 'GST', n: true }, { h: 'Total', n: true }, { h: 'Share', n: true, int: true, w: 9 }],
    rows: R.map(([c, o]) => ({ k: c, c: [c, o.n, rpN(o.cash), rpN(o.bank), rpN(o.g), inr2f(o.t), pc(o.t).toFixed(1) + '%'],
      h: { 6: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ display: 'inline-block', width: 60, height: 6, borderRadius: 3, background: 'var(--bd,#e2e8f0)', overflow: 'hidden' }}><em style={{ display: 'block', height: '100%', width: `${pc(o.t)}%`, background: 'var(--ac)' }}></em></i>{pc(o.t).toFixed(1)}%</span> } })),
    foot: ['Total', A.length, rpN(T('cash')), rpN(T('bank')), rpN(T('g')), inr2f(tot), '100%'], empty: 'No expenses in this period.',
    note: 'Click a category to see its entries.', click: (k) => { RPF.exCat = k; RPF.exAcct = 'all'; props.open('expl'); },
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}

function Expi(props: RpProps) {
  const A0 = useRows(props.p);
  const cats = useCats();
  const [cat, setCatS] = useState(RPF.exCat);
  if (!A0 || !cats.data) return null;
  const setCat = (v: string) => { RPF.exCat = v; setCatS(v); };
  const A: ExpenseRow[] = A0.filter((x) => cat === 'all' || x.category === cat);
  const by = new Map<string, { cat: string; nm: string; q: number; n: number; t: number }>();
  A.forEach((x) => x.lines.forEach((l) => { const nm = (l.name || '').trim() || '(no description)', k = x.category + '\u0001' + nm; const o = by.get(k) ?? { cat: x.category, nm, q: 0, n: 0, t: 0 }; o.q += Number(l.qty) || 0; o.n++; o.t += Number(l.amt) || 0; by.set(k, o); }));
  const R = [...by.values()].sort((a, b) => b.t - a.t), tot = r2(R.reduce((a, o) => a + o.t, 0));
  const def: RpDef = {
    title: 'Expense Item Report', group: 'Expense report', sub: cat === 'all' ? '' : cat,
    filters: <Sel id="rpXi" label="Category" opts={[['all', 'All categories'], ...cats.data.map((c) => [c.name, c.name] as [string, string])]} value={cat} onChange={setCat} />,
    kpis: [['Total spent', inr2f(tot), 'pscl neg'], ['Expense items', String(R.length)], ['Top item', R.length ? R[0]!.nm : '—', '', R.length ? inr2f(R[0]!.t) : '']],
    cols: [{ h: 'Expense item', w: 30 }, { h: 'Category', w: 20 }, { h: 'Times', n: true, int: true, w: 8 }, { h: 'Qty', n: true, int: true, w: 8 }, { h: 'Avg. rate', n: true }, { h: 'Total', n: true }],
    rows: R.map((o) => ({ c: [o.nm, o.cat, o.n, +o.q.toFixed(2), inr2f(o.q ? o.t / o.q : 0), inr2f(o.t)] })),
    foot: ['Total', '', R.reduce((a, o) => a + o.n, 0), '', '', inr2f(tot)], empty: 'No expense items in this period.',
    note: 'Built from the lines on each expense. Name lines the same way (for example “Shop rent”, “Delivery van diesel”) to keep this report tidy.',
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}

export const ExpenseReports: Record<string, ComponentType<RpProps>> = { expl: Expl, expc: Expc, expi: Expi };
