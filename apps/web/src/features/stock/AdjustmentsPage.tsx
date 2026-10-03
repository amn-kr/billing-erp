/** Stock adjustments (#vAdjs) — same markup as the prototype's renderAdjs; "New adjustment" opens Adjust stock with the item picker. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { money, type Money } from '@billing/shared';
import { api } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { useCur } from '../../lib/settings';
import { useFitTables } from '../../lib/useFitTables';
import { Icon, RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { AdjustStockDialog } from '../items/AdjustStockDialog';
import { qfmt, type Item } from '../items/ItemsPage';

interface Adjustment { id: string; number: string; date: string; itemId: string; item: string; unit: string; godown: string; qty: string; rate: string; value: string; reason: string; cancelled: boolean }

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';

export function AdjustmentsPage() {
  useFitTables();
  const cur = useCur();
  const { showToast } = useShell();
  const list = useQuery({ queryKey: ['stock-adjustments'], queryFn: () => api<Adjustment[]>('/stock-adjustments') });
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items') });
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'add' | 'reduce'>('all');
  const [why, setWhy] = useState('all');
  const [adding, setAdding] = useState<Item | null>(null);

  if (!list.data) return <section id="vAdjs"></section>;
  const A = list.data.filter((a) => !a.cancelled);
  const prods = (items.data ?? []).filter((i) => i.kind === 'goods');
  const v = (x: Adjustment[]): Money => x.reduce((s, a) => s.plus(a.value), money(0));
  const add = v(A.filter((a) => Number(a.qty) > 0));
  const red = v(A.filter((a) => Number(a.qty) < 0));
  const net = add.minus(red);
  const reasons = [...new Set(A.map((a) => a.reason))];
  const s = q.toLowerCase();
  const L = A.filter((a) => (kind === 'all' || (kind === 'add' ? Number(a.qty) > 0 : Number(a.qty) < 0)) && (why === 'all' || a.reason === why)
    && (!s || a.item.toLowerCase().includes(s) || a.number.toLowerCase().includes(s)));

  const openNew = () => {
    if (!prods.length) return showToast('Add an item first — Items & stock › Add item');
    setAdding(prods[0]!);
  };

  return (
    <section id="vAdjs">
      <div className="pthd"><h1 className="ptkind" style={{ cursor: 'default' }}>Stock adjustments</h1><div className="sp"></div><button className="btn p" id="adjNew" onClick={openNew}><Icon name="plus" />New adjustment</button></div>
      <div className="sumrow" id="adjSum">
        <div><small>Adjustments</small><b>{A.length}</b></div><div><small>Stock added</small><b className="pos">+{cur(inr(add))}</b></div><div><small>Stock reduced</small><b className="neg">−{cur(inr(red))}</b></div>
        <div><small>Net effect on stock value</small><b className={net.lt(0) ? 'neg' : 'pos'}>{net.lt(0) ? '−' : '+'}{cur(inr(net.abs()))}</b></div>
      </div>
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center' }}><label className="search" htmlFor="adjQ" style={{ maxWidth: 300, height: 36 }}><RawIcon d={SEARCH} /><input id="adjQ" placeholder="Search item or reference" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="seg2 sm" id="adjKind">{([['all', 'All'], ['add', 'Added'], ['reduce', 'Reduced']] as const).map(([k, t]) => <button data-ak={k} className={kind === k ? 'on' : ''} key={k} onClick={() => setKind(k)}>{t}</button>)}</div>
          <select className="fi" id="adjWhyF" aria-label="Filter by reason" value={why} onChange={(e) => setWhy(e.target.value)}><option value="all">All reasons</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Reference</th><th>Item</th><th>Reason</th><th>Type</th><th className="n">Quantity</th><th className="n">Price / unit</th><th className="n">Value</th></tr></thead>
          <tbody id="adjRows">
            {L.length ? L.map((a) => {
              const up = Number(a.qty) > 0;
              return (
                <tr key={a.id}><td>{dmy(a.date)}</td><td className="mono">{a.number}</td><td><b style={{ fontWeight: 600 }}>{a.item}</b></td><td>{a.reason}</td>
                  <td><span className={`stt ${up ? 'g' : 'r'}`}>{up ? 'Added' : 'Reduced'}</span></td><td className={`n ${up ? 'pos' : 'neg'}`}>{up ? '+' : '−'}{qfmt(Math.abs(Number(a.qty)))} {a.unit}</td><td className="n">{inr2f(a.rate)}</td><td className="n">{inr2f(a.value)}</td></tr>
              );
            }) : <tr><td colSpan={8} className="ptempty">{A.length ? 'No adjustments match these filters.' : 'No stock adjustments yet. Use “New adjustment” when a physical count doesn’t match, or goods are damaged or lost.'}</td></tr>}
          </tbody></table></div>
      </div>
      <AdjustStockDialog item={adding} choices={prods} onClose={() => setAdding(null)} />
    </section>
  );
}
