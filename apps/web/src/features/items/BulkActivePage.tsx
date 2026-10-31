/**
 * Items › ⋮ › Bulk active / inactive (#vBulkAct). Every product (one row per variant, with its brand
 * and series) in the Bulk update items table (SheetGrid), read-only: tick rows, then Make inactive or
 * Make active. A confirm box first (no passcode), then the server changes all the ticked items or
 * none; items already in that state are skipped. No delete here.
 * Not in the prototype — built from Bulk update items' look and the prototype's classes (pthd,
 * ptkind, pttot, card, ptfil, search, fi, seg2, st, brc, msg, ov/mdl).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BULK_ACTIVE_MAX, type BulkActiveInput, type BulkActiveResult } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { go } from '../../lib/go';
import { useEscape } from '../../lib/useEscape';
import { SheetGrid, type SheetColumn } from '../../components/SheetGrid';
import { RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { qfmt, type Item } from './ItemsPage';

interface Row extends Item { archived: boolean }
type Show = 'active' | 'inactive' | 'all';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const n = (v: number) => v.toLocaleString('en-IN');
const plural = (c: number, w: string, ws = w + 's') => `${n(c)} ${c === 1 ? w : ws}`;
const hasStock = (i: Row) => !!i.stock && Number(i.stock) !== 0;
const COLUMNS: SheetColumn[] = [
  { key: 'brand', title: 'Brand', width: 170, readOnly: true, placeholder: '—' },
  { key: 'series', title: 'Series', width: 170, readOnly: true, placeholder: '—' },
  { key: 'stock', title: 'Stock', width: 150, grow: true, readOnly: true },
];

export function BulkActivePage() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const list = useQuery({ queryKey: ['items', 'all'], queryFn: () => api<Row[]>('/items?archived=all&kind=goods') });
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [show, setShow] = useState<Show>('active');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverMsg, setServerMsg] = useState('');

  const IT = useMemo(() => list.data ?? [], [list.data]);
  const brands = useMemo(() => [...new Set(IT.map((i) => i.brand).filter(Boolean))].sort(), [IT]);
  const cats = useMemo(() => [...new Set(IT.map((i) => i.category).filter(Boolean))].sort(), [IT]);
  const s = q.trim().toLowerCase();
  const rows = IT.filter((i) =>
    (show === 'all' || i.archived === (show === 'inactive'))
    && (!brand || i.brand === brand)
    && (!category || (category === '—' ? !i.category : i.category === category))
    && (!s || i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s)));
  const pos = useMemo(() => new Map(IT.map((i, k) => [i.id, k + 1])), [IT]);
  const selRows = IT.filter((i) => sel.has(i.id));
  const active = IT.filter((i) => !i.archived).length;

  /** the header tick box: every row of the current filter, up to 500 */
  function tickAll(on: boolean) {
    if (!on) { setSel((x) => { const y = new Set(x); for (const r of rows) y.delete(r.id); return y; }); return; }
    const y = new Set(sel);
    for (const r of rows) { if (y.size >= BULK_ACTIVE_MAX) break; y.add(r.id); }
    setSel(y);
    if (rows.some((r) => !y.has(r.id))) showToast(`Up to ${BULK_ACTIVE_MAX} items can be changed at once: the first ${BULK_ACTIVE_MAX} are ticked.`);
  }

  function ask(makeActive: boolean) {
    setServerMsg('');
    if (!selRows.length) { showToast('Tick the items first.'); return; }
    if (selRows.length > BULK_ACTIVE_MAX) { showToast(`Up to ${BULK_ACTIVE_MAX} items can be changed at once. Untick some.`, 'error'); return; }
    setConfirm(makeActive);
  }

  async function save(makeActive: boolean) {
    const body: BulkActiveInput = { ids: selRows.map((i) => i.id), active: makeActive };
    setBusy(true);
    try {
      const r = await api<BulkActiveResult>('/items/bulk-active', { body });
      setConfirm(null);
      setSel(new Set());
      const word = makeActive ? 'active' : 'inactive';
      const already = `${r.skipped === 1 ? 'was' : 'were'} already ${word}`;
      showToast(r.changed ? `${plural(r.changed, 'item')} made ${word}${r.skipped ? ` (${n(r.skipped)} ${already})` : ''}` : `Nothing to change: ${plural(r.skipped, 'item')} ${already}`, 'ok');
      await Promise.all(['items', 'item', 'items-inactive', 'catalogue'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e) {
      setConfirm(null);
      setServerMsg(e instanceof ApiError ? e.message : 'Could not change the items. Nothing was changed — try again.');
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <>
      <button className="lnk" id="baBack" style={{ fontSize: 12, padding: 0 }} onClick={() => go('/items')}>← Items</button>
      <div className="pthd">
        <h1 className="ptkind" style={{ cursor: 'default' }}>Bulk Active / Inactive</h1>
        <div className="pttot" id="baTot"><span>{plural(active, 'active item')}</span><span>{n(IT.length - active)} inactive</span></div>
        <div className="sp"></div>
      </div>
    </>
  );
  if (list.isLoading) return <section id="vBulkAct">{header}</section>;

  return (
    <section id="vBulkAct">
      {header}
      {serverMsg && <div className="msg bad" id="baErr" role="alert">{serverMsg}</div>}
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center', gap: 12 }}>
          <label className="search" htmlFor="baQ" style={{ height: 34 }}><RawIcon d={SEARCH} /><input id="baQ" placeholder="Search by item name or code" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <select className="fi" id="baBrand" aria-label="Filter by brand" value={brand} style={{ width: 'auto', height: 34, margin: 0 }} onChange={(e) => setBrand(e.target.value)}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b}>{b}</option>)}
          </select>
          <select className="fi" id="baCat" aria-label="Filter by category" value={category} style={{ width: 'auto', height: 34, margin: 0 }} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            <option value="—">No category</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
          <div className="seg2 sm" id="baShow" role="group" aria-label="Show">
            {([['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']] as const).map(([k, t]) => (
              <button key={k} type="button" data-show={k} className={show === k ? 'on' : undefined} aria-pressed={show === k} onClick={() => setShow(k)}>{t}</button>
            ))}
          </div>
        </div>
        <SheetGrid
          id="baGrid"
          columns={COLUMNS}
          rows={rows}
          rowKey={(i) => i.id}
          rowLabel={(i) => pos.get(i.id)}
          rowName={(i) => i.name}
          lead={{ title: 'Item name', width: 260, cell: (i) => i.name }}
          value={(i, k) => (k === 'stock' ? (i.stock === null ? '' : `${qfmt(i.stock)} ${i.unit}`.trim()) : k === 'brand' ? i.brand : i.series)}
          onChange={() => {}}
          tail={{ title: 'Status', width: 110, cell: (i) => (i.archived ? <span className="st q">Inactive</span> : <span className="st g">Active</span>) }}
          selection={{
            selected: sel,
            onToggle: (k, on) => setSel((x) => { const y = new Set(x); if (on) y.add(k); else y.delete(k); return y; }),
            onToggleAll: tickAll,
          }}
          empty={IT.length ? 'No items match.' : 'No products yet. Add items first.'}
        />
        <div className="egpg" id="baBar">
          <span className="brc" id="baChip" style={{ fontSize: 12, padding: '3px 10px' }}>{plural(selRows.length, 'item')} selected</span>
          <button className="btn" id="baInactive" disabled={busy} onClick={() => ask(false)}>Make inactive</button>
          <button className="btn p" id="baActive" disabled={busy} onClick={() => ask(true)}>Make active</button>
        </div>
      </div>
      {confirm !== null && (
        <div className="ov c" id="baConfirm" onClick={(e) => { if ((e.target as HTMLElement).id === 'baConfirm' && !busy) setConfirm(null); }}>
          <ConfirmBody busy={busy} makeActive={confirm} items={selRows.length} withStock={confirm ? 0 : selRows.filter((i) => !i.archived && hasStock(i)).length} onCancel={() => setConfirm(null)} onGo={() => void save(confirm)} />
        </div>
      )}
    </section>
  );
}

function ConfirmBody({ busy, makeActive, items, withStock, onCancel, onGo }: { busy: boolean; makeActive: boolean; items: number; withStock: number; onCancel: () => void; onGo: () => void }) {
  useEscape(!busy, onCancel);
  const word = makeActive ? 'active' : 'inactive';
  return (
    <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bacT">
      <h3 id="bacT" style={{ margin: '0 0 12px', fontSize: 18 }}>Make {plural(items, 'item')} {word}?</h3>
      <p id="bacD" style={{ margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.6 }}>
        {makeActive ? 'They can be picked on new bills again.' : 'They are hidden from the item list and from new bills. Old bills and stock reports keep them, and you can make them active again.'}
      </p>
      {withStock > 0 && <p id="bacStock" style={{ margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.6 }}><b>{withStock === 1 ? '1 of them still has stock.' : `${n(withStock)} of them still have stock.`}</b></p>}
      <p className="mu" style={{ margin: '0 0 14px', fontSize: 12.5, lineHeight: 1.6 }}>All of them are changed together. If one can’t be changed, none is, and you are told which one and why.</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn" type="button" id="bacCancel" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="btn p" type="button" id="bacGo" disabled={busy} onClick={onGo}>{busy ? 'Saving…' : `Make ${word}`}</button>
      </div>
    </div>
  );
}
