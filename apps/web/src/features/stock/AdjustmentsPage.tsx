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
import { atButton, RowMenu, RowMenuButton, rowMenuHandlers, type RowAction, type RowMenuAt } from '../../components/RowMenu';
import { HIST_ACTION, openHistory } from '../../components/EditHistory';
import { SlModal, type SlModalProps } from '../sales/SlModal';
import { ui } from '../../styles/uiSize';

export interface Adjustment { batchId?: string | null; batchNo?: string; mfg?: string | null; expiry?: string | null; id: string; number: string; date: string; itemId: string; item: string; unit: string; godown: string; qty: string; rate: string; value: string; reason: string; cancelled: boolean }

const ADJ_ACT: RowAction[] = [['edit', 'Edit'], HIST_ACTION];
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
  const [editing, setEditing] = useState<Adjustment | null>(null);
  const [menu, setMenu] = useState<RowMenuAt<Adjustment> | null>(null);
  const [hist, setHist] = useState<SlModalProps | null>(null);

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

  const rm = rowMenuHandlers('tr[data-adj]', (tr) => L.find((a) => a.number === tr.dataset.adj), setMenu);
  const m = menu?.row;
  /** Edit: the Adjust stock window with the saved adjustment (its item still listed even if it is no longer active). */
  const openEdit = (a: Adjustment) => {
    if (a.cancelled) return showToast('This adjustment is cancelled, so it can’t be changed.');
    const it = prods.find((i) => i.id === a.itemId);
    if (!it) return showToast('This item is no longer active. Make it active again to change this adjustment.');
    setEditing(a); setAdding(it);
  };
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
        <div className="ptfil" style={{ padding: ui.sp('14px 16px'), alignItems: 'center' }}><label className="search" htmlFor="adjQ" style={{ maxWidth: 300, height: ui.h(36) }}><RawIcon d={SEARCH} /><input id="adjQ" placeholder="Search item or reference" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="seg2 sm" id="adjKind">{([['all', 'All'], ['add', 'Added'], ['reduce', 'Reduced']] as const).map(([k, t]) => <button data-ak={k} className={kind === k ? 'on' : ''} key={k} onClick={() => setKind(k)}>{t}</button>)}</div>
          <select className="fi" id="adjWhyF" aria-label="Filter by reason" value={why} onChange={(e) => setWhy(e.target.value)}><option value="all">All reasons</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="tw" style={{ margin: 0 }}><table className="ptt2"><thead><tr><th>Date</th><th>Reference</th><th>Item</th><th>Reason</th><th>Type</th><th className="n">Quantity</th><th className="n">Price / unit</th><th className="n">Value</th><th className="slact"><span className="vh">Actions</span></th></tr></thead>
          <tbody id="adjRows" onContextMenu={rm.onContextMenu} onKeyDown={(e) => { rm.menuKey(e); }}>
            {L.length ? L.map((a) => {
              const up = Number(a.qty) > 0;
              return (
                <tr key={a.id} tabIndex={0} data-adj={a.number} className={m?.id === a.id ? 'ctxon' : undefined}><td>{dmy(a.date)}</td><td className="mono">{a.number}</td><td><b style={{ fontWeight: 600 }}>{a.item}</b></td><td>{a.reason}</td>
                  <td><span className={`stt ${up ? 'g' : 'r'}`}>{up ? 'Added' : 'Reduced'}</span></td><td className={`n ${up ? 'pos' : 'neg'}`}>{up ? '+' : '−'}{qfmt(Math.abs(Number(a.qty)))} {a.unit}</td><td className="n">{inr2f(a.rate)}</td><td className="n">{inr2f(a.value)}</td>
                  <td className="slact"><RowMenuButton no={a.number} label={`Actions for ${a.number}`} onOpen={(b) => setMenu({ row: a, ...atButton(b), tr: b.closest('tr') })} /></td></tr>
              );
            }) : <tr><td colSpan={9} className="ptempty">{A.length ? 'No adjustments match these filters.' : 'No stock adjustments yet. Use “New adjustment” when a physical count doesn’t match, or goods are damaged or lost.'}</td></tr>}
          </tbody></table></div>
      </div>
      <RowMenu id="adjCtx" label="Adjustment actions" rows="#adjRows tr[data-adj]" menu={menu} head={m ? <><b>{m.number}</b> · {m.item}</> : null} actions={ADJ_ACT}
        off={m?.cancelled ? { edit: 'Cancelled. It can’t be changed.' } : undefined} onClose={() => { const tr = menu?.tr; setMenu(null); return tr; }}
        onPick={(k) => { const a = menu?.row; setMenu(null); if (!a) return; if (k === 'hist') void openHistory('stock-adjustment', a.id, setHist, showToast); else openEdit(a); }} />
      <AdjustStockDialog item={adding} choices={prods} edit={editing} onClose={() => { setAdding(null); setEditing(null); }} />
      <SlModal m={hist} onClose={() => setHist(null)} />
    </section>
  );
}
