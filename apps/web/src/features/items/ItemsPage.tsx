/**
 * Items (#vItems) — same markup as the prototype's renderItems /
 * renderItemDetail (including the "Brands & variants" version: items in a
 * group with several brands/sizes show as one expandable row with a
 * variants table).
 */
import { Fragment, useMemo, useState, type MouseEvent as RMouseEvent } from 'react';
import { go } from '../../lib/go';
import { useQuery } from '@tanstack/react-query';
import { money, sumValues, type RateTable as Rates } from '@billing/shared';
import { api } from '../../lib/api';
import { dmy, inr, inr2f } from '../../lib/format';
import { useCur, useSettings } from '../../lib/settings';
import { useFitTables } from '../../lib/useFitTables';
import { Icon, RawIcon } from '../../components/Icon';
import { soon, useShell } from '../shell/store';
import { AddItemDialog } from './AddItemDialog';
import { AdjustStockDialog } from './AdjustStockDialog';
import { RateTable } from './RateTable';

export interface Item {
  id: string;
  kind: 'goods' | 'service';
  name: string;
  code: string;
  hsn: string;
  unit: string;
  category: string;
  brand: string;
  group: string;
  series: string;
  gstRate: string;
  sale: string;
  purchase: string;
  mrp: string;
  listPrice: string;
  minStock: string;
  location: string;
  stock: string | null;
  /** what is left × its own purchase rate (first in, first out); null for a service */
  value: string | null;
  /** average purchase rate of what is left */
  avgRate: string | null;
  level: 'ok' | 'low' | 'out';
  createdAt: string;
  /** the item's id in the old app's backup, when imported */
  legacyId?: string | null;
}

interface Movement { id: string; date: string; kind: string; qty: string; rate: string; note: string; ref: string; sourceType: string; party: string; status: string; createdAt: string }
interface ItemDetail extends Item { movements: Movement[]; rateTable: Rates | null }

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const FILTER = '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>';
const PRINT = '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>';
const DOTS = '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>';
const CHEV = '<path d="M6 9l6 6 6-6"/>';
const CAR = '<path d="M9 6l6 6-6 6"/>';
const UP = '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>';

/** Prototype qfmt(): up to 2 decimals, Indian grouping. */
export const qfmt = (v: string | number | null) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const gst = (i: Item) => String(Number(i.gstRate));
const n = (v: string) => Number(v);
const isNew = (i: Item) => Math.abs(Date.now() - Date.parse(i.createdAt)) < 7 * 86_400_000;
const vlabel = (i: Item) => `${i.brand || ''}${i.series ? ' ' + i.series : ''}`.trim() || i.name;
const lvlClass = (l: Item['level']) => (l === 'out' ? 'neg' : l === 'low' ? 'lowq' : 'zero');

/** Prototype item transaction rows, from the stock ledger: invoice / bill number, party and status come from the API. */
function txRows(i: ItemDetail) {
  const label: Record<string, string> = { opening: 'Opening stock', adjustment: 'Adjustment', transfer: 'Transfer', sale: 'Sale', purchase: 'Purchase', return: 'Sale return', purchase_return: 'Purchase return' };
  const cancelled: Record<string, string> = { sales_document: 'Sale cancelled', purchase_document: 'Purchase cancelled' };
  return i.movements.map((m) => ({
    id: m.id,
    type: m.kind === 'cancel' ? cancelled[m.sourceType] ?? 'Cancelled' : label[m.kind] ?? m.kind,
    ref: m.kind === 'opening' ? '—' : m.ref || '—',
    party: m.kind === 'adjustment' ? m.note : m.party,
    date: dmy(m.date),
    iso: m.date,
    qty: n(m.qty),
    price: m.rate,
    st: m.kind === 'adjustment' ? (n(m.qty) >= 0 ? 'Added' : 'Reduced') : m.status,
  }));
}
const SC: Record<string, string> = { Paid: 'g', Unpaid: 'a', 'Partly paid': 'b', Overdue: 'r', 'Due today': 'a', Reduced: 'r', Added: 'g' };

export function ItemsPage() {
  useFitTables();
  const cur = useCur();
  const mrpOn = !!useSettings().data?.data?.mrp;
  const { showToast } = useShell();
  const list = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items') });
  const [kind, setKind] = useState<'p' | 's'>('p');
  const [stockF, setStockF] = useState<'all' | 'low' | 'out' | 'ok'>('all');
  const [brand, setBrand] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pop, setPop] = useState<'kind' | 'more' | 'fil' | null>(null);
  const [tsOpen, setTsOpen] = useState(false);
  const [tq, setTq] = useState('');
  const [tType, setTType] = useState('all');
  const [filOpen, setFilOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [adjusting, setAdjusting] = useState<Item | null>(null);

  const IT = list.data ?? [];
  const members = (g: string) => IT.filter((i) => i.group === g);
  const BRANDS = [...new Set(IT.map((i) => i.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const L = useMemo(() => {
    const s = q.toLowerCase();
    return IT.filter((i) => (kind === 'p' ? i.kind === 'goods' : i.kind === 'service') && (brand === 'all' || i.brand === brand)
      && (!s || i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s) || i.hsn.includes(s) || i.brand.toLowerCase().includes(s))
      && (stockF === 'all' || i.level === stockF));
  }, [IT, q, kind, brand, stockF]);

  let selId = sel;
  const isG = !!selId && selId.startsWith('g:');
  if (!(isG && L.some((i) => 'g:' + i.group === selId)) && !(selId && L.some((i) => i.id === selId))) {
    const f = L[0];
    selId = f ? (f.group && members(f.group).length > 1 ? 'g:' + f.group : f.id) : IT.find((i) => (kind === 'p' ? i.kind === 'goods' : i.kind === 'service'))?.id ?? null;
  }
  const detail = useQuery({
    queryKey: ['item', selId],
    queryFn: () => api<ItemDetail>(`/items/${selId}`),
    enabled: !!selId && !selId.startsWith('g:'),
  });

  const prods = IT.filter((i) => i.kind === 'goods');
  const val = sumValues(prods.map((i) => i.value ?? '0'));
  const low = prods.filter((i) => i.level === 'low').length;
  const out = prods.filter((i) => i.level === 'out').length;
  const toggle = (k: 'kind' | 'more' | 'fil') => (e: RMouseEvent) => {
    e.stopPropagation();
    setPop(pop === k ? null : k);
  };
  const filtered = !!q || brand !== 'all' || stockF !== 'all';

  const row = (i: Item, sub: boolean) => (
    <button className={`ptr ${sub ? 'vsub' : ''} ${i.id === selId ? 'on' : ''}`} data-iid={i.id} key={i.id} onClick={() => setSel(i.id)}>
      <span className="ptn" style={{ textTransform: 'none', fontSize: 13 }}>
        {sub ? vlabel(i) : i.name}
        {!sub && i.brand && !i.group && <>{' '}<span className="brc">{i.brand}</span></>}
        {isNew(i) && <>{' '}<span className="st b" style={{ fontSize: 10, padding: '1px 6px' }}>New</span></>}
      </span>
      <span className={lvlClass(i.level)}>{i.kind === 'service' ? inr2f(i.sale) : qfmt(i.stock)}{(i.level === 'low' || i.level === 'out') && <>{' '}<i className="ldot"></i></>}</span>
    </button>
  );
  const rows: JSX.Element[] = [];
  const seen = new Set<string>();
  L.forEach((i) => {
    if (i.group && members(i.group).length > 1) {
      if (seen.has(i.group)) return;
      seen.add(i.group);
      const ms = L.filter((x) => x.group === i.group);
      const all = members(i.group);
      const tot = ms.reduce((a, x) => a + n(x.stock ?? '0'), 0);
      const bad = ms.some((x) => x.level !== 'ok');
      const isOpen = open.has(i.group) || filtered || (!!selId && ms.some((x) => x.id === selId));
      const word = all.every((x) => x.brand) && new Set(all.map((x) => x.brand)).size === all.length ? 'brands' : 'variants';
      rows.push(
        <button className={`ptr grh ${selId === 'g:' + i.group ? 'on' : ''}`} data-gid={i.group} aria-expanded={isOpen} key={'g:' + i.group}
          onClick={() => { const k = i.group; const nx = new Set(open); if (selId === 'g:' + k && open.has(k)) nx.delete(k); else nx.add(k); setOpen(nx); setSel('g:' + k); }}>
          <span className="ptn" style={{ textTransform: 'none', fontSize: 13 }}><svg className={`i car2 ${isOpen ? 'op' : ''}`} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: CAR }} />{i.group}{' '}<span className="brc">{all.length} {word}</span></span>
          <span className={bad ? 'lowq' : 'zero'}>{qfmt(tot)}{bad && <>{' '}<i className="ldot"></i></>}</span>
        </button>,
      );
      if (isOpen) ms.forEach((x) => rows.push(row(x, true)));
    } else rows.push(row(i, false));
  });

  if (list.isLoading) return <section id="vItems"></section>;
  const groupSel = selId?.startsWith('g:') ? selId.slice(2) : null;
  const item = detail.data && detail.data.id === selId ? detail.data : null;

  return (
    <section id="vItems" onClick={() => setPop(null)}>
      <div className="pthd">
        <div className="rel">
          <button className="ptkind" id="itKindBtn" aria-haspopup="true" onClick={toggle('kind')}><span id="itKind">{kind === 'p' ? 'Products' : 'Services'}</span><RawIcon d={CHEV} /></button>
          <div className="pop" id="itKindPop" hidden={pop !== 'kind'} style={{ left: 0, right: 'auto' }}>
            <button data-ik="p" onClick={() => { setKind('p'); setSel(null); }}>Products</button>
            <button data-ik="s" onClick={() => { setKind('s'); setSel(null); }}>Services</button>
          </div>
        </div>
        <div className="pttot" id="itTot">
          {kind === 'p' ? (
            <>
              <span>Stock value <b>{cur(inr(val))}</b></span>
              <span><i style={{ background: 'var(--amber)' }}></i>Low stock <b>{low}</b></span>
              <span><i style={{ background: 'var(--red)' }}></i>Out of stock <b>{out}</b></span>
              <span>{BRANDS.length} brands</span>
            </>
          ) : <span>{IT.filter((i) => i.kind === 'service').length} services</span>}
        </div>
        <div className="sp"></div>
        {/* an icon button, as the ⋯ one: a text button does not fit the top bar at 1280 px (owner's choice) */}
        {kind === 'p' && <button className="ib" id="itImport" aria-label="Import products" title="Import products" onClick={() => go('/items/import')}><RawIcon d={UP} /></button>}
        {kind === 'p' && <button className="btn" id="itBrands" onClick={() => go('/items/brands')}>Brands &amp; Series</button>}
        <button className="btn p" data-soon="New item" onClick={() => setAdding(true)}><Icon name="plus" />Add item</button>
        <div className="rel">
          <button className="ib" id="itMoreBtn" aria-label="More options" onClick={toggle('more')}><RawIcon d={DOTS} /></button>
          <div className="pop" id="itMorePop" hidden={pop !== 'more'}>
            <button id="itImportMenu" onClick={() => go('/items/import')}>Import products</button>
            <button data-view="prices" onClick={() => soon('Price manager')}>Update prices in bulk</button>
            <button id="itBulkMenu" onClick={() => go('/items/bulk-update')}>Bulk update items</button>
            <button id="itRateBtn" onClick={() => soon('Rate list')}>Download rate list</button>
            <button data-soon="Item categories" onClick={() => soon('Item categories')}>Manage categories</button>
            <button data-soon="Units" onClick={() => soon('Units')}>Manage units</button>
            <button data-soon="Barcode printing" onClick={() => soon('Barcode printing')}>Print barcodes</button>
          </div>
        </div>
      </div>
      <div className="ptg">
        <div className="card ptl">
          <select className="fi itbr" id="itBrand" aria-label="Filter by brand" hidden={kind !== 'p'} value={brand} onChange={(e) => { setBrand(e.target.value); setSel(null); }}>
            <option value="all">All brands</option>
            {BRANDS.map((b) => <option key={b}>{b}</option>)}
          </select>
          <label className="search pts" htmlFor="itQ"><RawIcon d={SEARCH} /><input id="itQ" placeholder="Search name, brand, code or HSN" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="ptlh">
            <span>Item</span>
            <div className="rel" hidden={kind !== 'p'}>
              <button className="ixs" id="itFilBtn" aria-label="Filter by stock" title="Filter by stock" onClick={toggle('fil')}><RawIcon d={FILTER} /><i className="fdot" id="itFilterDot" hidden={stockF === 'all'}></i></button>
              <div className="pop" id="itFilPop" hidden={pop !== 'fil'} style={{ left: 0, right: 'auto' }}>
                <h4>Show</h4>
                {([['all', 'All items'], ['low', 'Low stock'], ['out', 'Out of stock'], ['ok', 'In stock']] as const).map(([k, t]) => (
                  <button key={k} data-ist={k} className={stockF === k ? 'cur' : undefined} onClick={() => { setStockF(k); setSel(null); }}>{t}</button>
                ))}
              </div>
            </div>
            <span className="sp"></span>
            <span id="itQh">{kind === 'p' ? 'Quantity' : cur('Price (₹)')}</span>
          </div>
          <div className="ptlist" id="itList">
            {rows.length ? rows : <div className="ptempty">No items match.<br /><button className="lnk" data-soon="New item" onClick={() => setAdding(true)}>+ Add item</button></div>}
          </div>
        </div>
        <div className="ptr2" id="itRight">
          <div className="card" id="itHead">
            {groupSel ? (
              <GroupHead g={groupSel} ms={members(groupSel)} mrpOn={mrpOn} cur={cur} onPick={setSel} />
            ) : item ? (
              <ItemHead i={item} mrpOn={mrpOn} onBack={(g) => setSel('g:' + g)} onAdjust={() => setAdjusting(item)} />
            ) : !selId ? (
              <div className="ptempty">No item selected.</div>
            ) : null}
          </div>
          <div className="card ptxc" hidden={!!groupSel}>
            <div className="hd" style={{ margin: 0, padding: '14px 16px' }}>
              <h3>Transactions</h3>
              <div className="ptools">
                <div className={tsOpen ? 'xsr open' : 'xsr'} id="itTsWrap">
                  <button className="ixs" id="itTsBtn" type="button" title="Search transactions" aria-label="Search transactions" aria-expanded={tsOpen} onMouseDown={(e) => tsOpen && e.preventDefault()} onClick={() => { if (!tsOpen) { setTsOpen(true); setTimeout(() => document.getElementById('itTq')?.focus(), 30); } else { setTq(''); setTsOpen(false); } }}><RawIcon d={SEARCH} /></button>
                  <input className="fi" id="itTq" placeholder="Search invoice or party" autoComplete="off" tabIndex={tsOpen ? 0 : -1} aria-label="Search transactions" value={tq} onChange={(e) => setTq(e.target.value)} onBlur={() => !tq.trim() && setTsOpen(false)} />
                </div>
                <button className="ixs" id="itPrint" title="Download report" aria-label="Download report" onClick={() => soon('Item report')}><RawIcon d={PRINT} /></button>
                <button className="ixs xls" id="itXls" title="Export to Excel" aria-label="Export to Excel" onClick={() => showToast('Excel export comes with the reports')}>XLS</button>
              </div>
            </div>
            {(() => {
              const all = item ? txRows(item) : [];
              const types = [...new Set(all.map((t) => t.type))];
              const s = tq.toLowerCase();
              const tx = all.filter((t) => (tType === 'all' || t.type === tType) && (!s || t.ref.toLowerCase().includes(s) || t.party.toLowerCase().includes(s))).sort((a, b) => b.iso.localeCompare(a.iso));
              return (
                <>
                  <div className="ptfil" hidden={!filOpen}>
                    <select className="fi" id="itTypeSel" aria-label="Filter by type" value={tType} onChange={(e) => setTType(e.target.value)}>
                      <option value="all">All types</option>
                      {types.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="tw" style={{ margin: 0 }}>
                    <table className="ptt2">
                      <thead>
                        <tr>
                          <th><span className="thw2">Type<button type="button" className="thf" data-thf="itTypeSel" aria-label="Filter by type" title="Filter by type" aria-haspopup="true" onClick={(e) => { e.stopPropagation(); setFilOpen(!filOpen); }}><RawIcon d={FILTER} /></button></span></th>
                          <th>Invoice / ref</th><th>Party / reason</th><th>Date</th><th className="n">Quantity</th><th className="n">Price / unit</th><th>Status</th>
                        </tr>
                      </thead>
                      <tbody id="itTx">
                        {item && tx.length ? tx.map((t) => (
                          <tr key={t.id}>
                            <td>{t.type}</td><td className="mono">{t.ref}</td><td>{t.party || <span style={{ color: 'var(--t2)' }}>—</span>}</td><td>{t.date}</td>
                            <td className={`n ${t.qty < 0 ? 'neg' : 'pos'}`}>{t.qty > 0 ? '+' : '−'}{qfmt(Math.abs(t.qty))} {item.unit}</td>
                            <td className="n">{inr2f(t.price)}</td>
                            <td>{t.st ? <span className={`stt ${SC[t.st] ?? 'b'}`}>{t.st}</span> : ''}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={7} className="ptempty">{all.length ? 'No transactions match.' : 'No transactions yet.'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
      <AddItemDialog open={adding} onClose={() => setAdding(false)} onSaved={(id, svc, group) => { setAdding(false); setKind(svc ? 's' : 'p'); setSel(group ? 'g:' + group : id); }} onOpenItem={(id) => { setAdding(false); setKind('p'); setSel(id); }} />
      <AdjustStockDialog item={adjusting} onClose={() => setAdjusting(null)} />
    </section>
  );
}

function ItemHead({ i, mrpOn, onBack, onAdjust }: { i: ItemDetail; mrpOn: boolean; onBack: (g: string) => void; onAdjust: () => void }) {
  const s = n(i.stock ?? '0');
  const l = i.kind === 'service' ? '' : i.level;
  const m = n(i.purchase) ? money(i.sale).minus(i.purchase) : money(0);
  const aboveMrp = mrpOn && n(i.mrp) > 0 && n(i.sale) > n(i.mrp);
  return (
    <>
      <div className="pth">
        <div style={{ minWidth: 0 }}>
          {i.group && <button className="lnk" data-gback={i.group} style={{ fontSize: 12, padding: 0 }} onClick={() => onBack(i.group)}>← {i.group}</button>}
          <div className="ptt">
            <h2 style={{ textTransform: 'none' }}>{i.group ? vlabel(i) : i.name}</h2>
            {i.brand && !i.group && <span className="brc">{i.brand}</span>}
            <button className="ixs" data-soon="Edit item" aria-label="Edit item" title="Edit item" onClick={() => soon('Edit item')}><Icon name="edit" /></button>
          </div>
          <div className="ptmeta">
            {i.code && <span className="mono">{i.code}</span>}
            {i.hsn && <span className="needs-gst">{i.kind === 'service' ? 'SAC' : 'HSN'} {i.hsn}</span>}
            <span>{i.category || 'No category'}</span>
            <span>Unit: {i.unit}</span>
            <span className="needs-gst">GST {gst(i)}%</span>
            {i.location && <span>{i.location}</span>}
          </div>
        </div>
        <div className="ptacts">
          {i.kind !== 'service' && <button className="btn sm" id="itAdj" onClick={onAdjust}><Icon name="swap" />Adjust stock</button>}
          <button className="btn p sm" data-sellitem={i.id} onClick={() => go(`/sales/new?item=${i.id}`)}><Icon name="plus" />Sell</button>
        </div>
      </div>
      <div className="itfig">
        {mrpOn && n(i.mrp) > 0 && <div><small>MRP</small><b>{inr2f(i.mrp)}</b></div>}
        <div><small>Sale price</small><b className={aboveMrp ? 'neg' : ''}>{inr2f(i.sale)}</b>{aboveMrp && <span className="tagw r">Above MRP</span>}</div>
        {i.kind !== 'service' && (
          <>
            <div><small>Purchase price</small><b>{inr2f(i.purchase)}</b></div>
            <div><small>Margin</small><b className="pos">{inr2f(m)}{n(i.purchase) > 0 && <>{' '}<em>({Math.round(m.div(i.purchase).times(100).toNumber())}%)</em></>}</b></div>
            {/* with MRP switched off the prototype strips every red .neg from this header (its MRP patch), so "Out of stock" quantity isn't red */}
            <div><small>In stock</small><b className={l === 'out' ? (mrpOn ? 'neg' : '') : l === 'low' ? 'lowq' : ''}>{qfmt(s)} {i.unit}</b>{l === 'low' ? <span className="tagw">Below {qfmt(i.minStock)}</span> : l === 'out' ? <span className="tagw r">Out of stock</span> : null}</div>
            <div><small>Stock value</small><b>{inr2f(i.rateTable?.value ?? '0')}</b></div>
            {i.rateTable && <RateTable t={i.rateTable} unit={i.unit} />}
          </>
        )}
      </div>
    </>
  );
}

function GroupHead({ g, ms, mrpOn, cur, onPick }: { g: string; ms: Item[]; mrpOn: boolean; cur: (t: string) => string; onPick: (id: string) => void }) {
  const f = ms[0]!;
  const tot = ms.reduce((a, x) => a + n(x.stock ?? '0'), 0);
  const val = sumValues(ms.map((x) => x.value ?? '0'));
  return (
    <>
      <div className="pth">
        <div style={{ minWidth: 0 }}>
          <div className="ptt"><h2 style={{ textTransform: 'none' }}>{g}</h2><span className="brc">{ms.length} variants</span></div>
          <div className="ptmeta">
            {f.hsn && <span className="needs-gst">HSN {f.hsn}</span>}
            <span>{f.category || 'No category'}</span><span>Unit: {f.unit}</span><span className="needs-gst">GST {gst(f)}%</span>
            <span>Total stock {qfmt(tot)} {f.unit}</span><span>Value {cur(inr(val))}</span>
          </div>
        </div>
        <div className="ptacts">
          <button className="btn sm" data-gprices={g} onClick={() => soon('Price manager')}><Icon name="edit" />Update prices</button>
        </div>
      </div>
      <div className="tw" style={{ margin: '14px -4px 0', overflowX: 'auto' }}>
        <table className="ptt2 vtab">
          <thead>
            <tr><th>Brand</th><th>Series / size</th><th>Item code</th>{mrpOn && <th className="n">MRP</th>}<th className="n">LP</th><th className="n">Purchase</th><th className="n">Sale</th><th className="n">Margin</th><th className="n">Stock</th><th></th></tr>
          </thead>
          <tbody>
            {ms.map((x) => {
              const m = n(x.purchase) ? ((n(x.sale) - n(x.purchase)) / n(x.purchase)) * 100 : 0;
              return (
                <Fragment key={x.id}>
                  <tr tabIndex={0} data-vsel={x.id} onClick={(e) => !(e.target as HTMLElement).closest('button') && onPick(x.id)} onKeyDown={(e) => e.key === 'Enter' && onPick(x.id)}>
                    <td><b style={{ fontWeight: 600 }}>{x.brand || '—'}</b></td><td>{x.series}</td><td className="mono">{x.code}</td>
                    {mrpOn && <td className="n">{n(x.mrp) ? inr2f(x.mrp) : '—'}</td>}
                    <td className="n">{n(x.listPrice) ? inr2f(x.listPrice) : '—'}</td><td className="n">{inr2f(x.purchase)}</td>
                    <td className="n"><b>{inr2f(x.sale)}</b>{mrpOn && n(x.mrp) > 0 && n(x.sale) > n(x.mrp) && <small className="neg">Above MRP</small>}</td>
                    <td className={`n ${m < 5 ? 'neg' : ''}`}>{m.toFixed(0)}%</td>
                    <td className={`n ${x.level === 'out' ? 'neg' : x.level === 'low' ? 'lowq' : ''}`}>{qfmt(x.stock)} {x.unit}</td>
                    <td className="n"><button className="btn sm" data-sellitem={x.id} onClick={() => go(`/sales/new?item=${x.id}`)}>Sell</button></td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
