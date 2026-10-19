/**
 * Items › ⋮ › Bulk update items (#vBulk). Every item in one editable grid with two tabs, Pricing and
 * Item Information (Stock comes later). Changes made in both tabs are kept while switching; nothing
 * is saved until Update, which checks every changed cell first, asks once (and for the edit passcode
 * when it is on), then sends only the changed rows: the server saves all of them or none.
 * Not in the prototype — built only from its classes (pthd, ptkind, card, ptfil, search, cb2, brc, thf,
 * thfp, thdr, msg, ov/mdl) and the EditGrid, like Import products.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useBlocker } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BULK_FIELD_TAB, BULK_TABS, bulkCellProblem, bulkSame, parseInrAmount,
  type BulkField, type BulkItemsInput, type BulkItemsResult, type BulkTab,
} from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { go } from '../../lib/go';
import { inr2f } from '../../lib/format';
import { useCur, useSettings } from '../../lib/settings';
import { useEscape } from '../../lib/useEscape';
import { EditGrid, type GridColumn } from '../../components/EditGrid';
import { useDcf } from '../../components/Discard';
import { RawIcon } from '../../components/Icon';
import { ThfChoices, ThfPop, type ThfAnchor } from '../../components/ThfPop';
import { withPasscode } from '../settings/passcode';
import { useShell } from '../shell/store';
import type { Item } from './ItemsPage';

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const FILTER = '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>';
const n = (v: number) => v.toLocaleString('en-IN');
const plural = (c: number, w: string, ws = w + 's') => `${n(c)} ${c === 1 ? w : ws}`;

/** the grid's columns per tab; the first column (Item name) and the tick boxes are always there */
const TAB_FIELDS: Record<BulkTab, BulkField[]> = { pricing: ['category', 'purchase', 'sale', 'gstRate'], info: ['category', 'code'] };
const MONEY: BulkField[] = ['purchase', 'sale'];
type Edits = Record<string, Partial<Record<BulkField, string>>>;
type NumF = { op: 'eq' | 'gt' | 'lt' | 'bt'; a: number; b: number | null };
type Filters = Partial<Record<'lead' | BulkField, string | NumF | null>>;
const OPS: [NumF['op'], string][] = [['eq', 'Equal to'], ['gt', 'Greater than'], ['lt', 'Less than'], ['bt', 'Between']];

/** a saved value as it is shown in its cell */
const shown = (i: Item, f: BulkField) => (f === 'purchase' || f === 'sale' ? inr2f(i[f]) : f === 'gstRate' ? String(Number(i.gstRate)) : i[f]);

export function BulkUpdatePage() {
  const qc = useQueryClient();
  const cur = useCur();
  const { showToast } = useShell();
  const list = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items') });
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<{ categories: { name: string }[] }>('/catalogue') });
  const taxes = (useSettings().data?.taxes ?? []).filter((t) => t.kind === 'GST');
  const [tab, setTab] = useState<BulkTab>('pricing');
  const [q, setQ] = useState('');
  const [fx, setFx] = useState<Filters>({});
  const [pop, setPop] = useState<{ key: 'lead' | BulkField; anchor: ThfAnchor } | null>(null);
  const [edits, setEdits] = useState<Edits>({});
  /** the tab a category change was made in: it is counted there */
  const [catTab, setCatTab] = useState<Record<string, BulkTab>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverMsg, setServerMsg] = useState('');
  /** the cell the server refused (item id and field) */
  const [serverCell, setServerCell] = useState<{ id: string; field: BulkField; message: string } | null>(null);

  const IT = list.data ?? [];
  const byId = useMemo(() => new Map(IT.map((i) => [i.id, i])), [IT]);
  const cell = (i: Item, f: BulkField) => edits[i.id]?.[f] ?? shown(i, f);
  const changed = (i: Item, f: BulkField) => { const t = edits[i.id]?.[f]; return t !== undefined && !bulkSame(f, i[f], t); };
  const fieldsOf = (i: Item) => (['category', 'purchase', 'sale', 'gstRate', 'code'] as BulkField[]).filter((f) => changed(i, f));
  const tabOf = (id: string, f: BulkField): BulkTab => (f === 'category' ? catTab[id] ?? 'info' : BULK_FIELD_TAB[f]);
  const changedItems = IT.filter((i) => fieldsOf(i).length);
  const counts = { pricing: 0, info: 0 } as Record<BulkTab, number>;
  for (const i of changedItems) for (const t of new Set(fieldsOf(i).map((f) => tabOf(i.id, f)))) counts[t]++;
  const total = changedItems.length;

  /** every other item's code as it will be after Update, for the "already used" check */
  const codesBut = useMemo(() => {
    const all = IT.map((i) => [i.id, (edits[i.id]?.code ?? i.code).trim().toLowerCase()] as const).filter(([, c]) => c);
    return (id: string) => new Set(all.filter(([x]) => x !== id).map(([, c]) => c));
  }, [IT, edits]);
  /** the problems of the changed cells (shown after the first Update, then as the cells change) */
  const problems = useMemo(() => {
    const out = new Map<string, Partial<Record<BulkField, string>>>();
    for (const i of changedItems) {
      for (const f of fieldsOf(i)) {
        const p = bulkCellProblem(f, edits[i.id]![f]!, { id: i.id, name: i.name, code: i.code, mrp: i.mrp }, codesBut(i.id), (v) => cur('₹') + inr2f(v));
        if (p) out.set(i.id, { ...out.get(i.id), [f]: p });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, IT, codesBut]);
  const badCount = [...problems.values()].reduce((a, p) => a + Object.keys(p).length, 0);

  // leaving through the app asks first: the changes would be lost
  const blocker = useBlocker(({ currentLocation, nextLocation }) => total > 0 && !busy && currentLocation.pathname !== nextLocation.pathname);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let went = false;
    useDcf.getState().ask('bulk update', () => { went = true; blockerRef.current.proceed?.(); });
    const stop = useDcf.subscribe((s) => { if (!s.what) { stop(); setTimeout(() => { if (!went) blockerRef.current.reset?.(); }, 0); } });
    return stop;
  }, [blocker.state]);
  useEffect(() => {
    if (!total) return;
    const stop = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [total]);

  const edit = (id: string, f: BulkField, v: string) => {
    setEdits((e) => ({ ...e, [id]: { ...e[id], [f]: v } }));
    if (f === 'category') setCatTab((c) => ({ ...c, [id]: tab }));
    if (serverCell?.id === id && serverCell.field === f) { setServerCell(null); setServerMsg(''); }
  };

  const cats = cat.data?.categories.map((c) => c.name) ?? [];
  const taxName = (rate: string) => taxes.find((t) => Number(t.rate) === Number(rate))?.name ?? `GST ${Number(rate)}%`;
  const TITLES: Record<BulkField, string> = { category: 'Category', purchase: cur('Purchase price (₹)'), sale: cur('Sale price (₹)'), gstRate: 'Tax slab', code: 'Item code' };
  const columns: GridColumn[] = TAB_FIELDS[tab].map((f) => ({
    key: f, title: TITLES[f], num: MONEY.includes(f),
    width: f === 'category' ? 180 : f === 'gstRate' ? 150 : f === 'code' ? 180 : 140,
    ...(f === 'category' ? { list: { options: cats }, placeholder: 'No category' } : {}),
    ...(f === 'gstRate' ? { list: { options: [...new Set(taxes.map((t) => String(Number(t.rate))))], labels: Object.fromEntries(taxes.map((t) => [String(Number(t.rate)), t.name])) }, placeholder: 'Choose' } : {}),
    ...(MONEY.includes(f) ? { placeholder: '0.00' } : {}),
  }));

  // search (item name) and the heading filters, on what the cells show now
  const s = q.trim().toLowerCase();
  const pass = (i: Item) => {
    if (s && !i.name.toLowerCase().includes(s)) return false;
    for (const [k, v] of Object.entries(fx) as ['lead' | BulkField, Filters['lead']][]) {
      if (v === null || v === undefined || v === '') continue;
      const text = k === 'lead' ? i.name : cell(i, k);
      if (typeof v === 'string') {
        if (k === 'category' || k === 'gstRate') { if ((k === 'gstRate' ? String(Number(text)) : text) !== (v === '—' ? '' : v)) return false; }
        else if (!text.toLowerCase().includes(v.toLowerCase())) return false;
      } else {
        const x = Number(parseInrAmount(text) || 0);
        if (v.op === 'eq' ? x !== v.a : v.op === 'gt' ? x <= v.a : v.op === 'lt' ? x >= v.a : x < v.a || x > (v.b ?? v.a)) return false;
      }
    }
    return true;
  };
  const rows = IT.filter(pass);
  const pos = useMemo(() => new Map(IT.map((i, k) => [i.id, k + 1])), [IT]);
  const selRows = IT.filter((i) => sel.has(i.id));
  const noTax = selRows.filter((i) => Number(cell(i, 'gstRate')) === 0).length;

  const head = (key: string) => {
    const k = key as 'lead' | BulkField;
    const on = fx[k] !== undefined && fx[k] !== null && fx[k] !== '';
    const label = `Filter by ${k === 'lead' ? 'item name' : TITLES[k as BulkField].toLowerCase()}`;
    return <button type="button" className={`thf${on ? ' on' : ''}`} data-thf={`bu-${k}`} aria-label={label} title={label} aria-haspopup="true" onClick={(e) => { e.stopPropagation(); setPop(pop?.key === k ? null : { key: k, anchor: { el: e.currentTarget, clamp: true } }); }}><RawIcon d={FILTER} /></button>;
  };
  const setFilter = (k: 'lead' | BulkField, v: Filters['lead']) => { setFx((f) => ({ ...f, [k]: v })); const el = pop?.anchor.el; setPop(null); el?.focus(); };

  function update() {
    setChecked(true); setServerMsg(''); setServerCell(null);
    if (!total || badCount) return;
    setConfirm(true);
  }

  async function save() {
    const body: BulkItemsInput = {
      rows: changedItems.map((i) => {
        const r: BulkItemsInput['rows'][number] = { id: i.id };
        for (const f of fieldsOf(i)) {
          const t = edits[i.id]![f]!;
          if (f === 'purchase' || f === 'sale') r[f] = parseInrAmount(t) || '0';
          else if (f === 'gstRate') r.gstRate = Number(t);
          else r[f] = t.trim();
        }
        return r;
      }),
    };
    setBusy(true);
    try {
      const ok = await withPasscode(qc, { title: 'Passcode needed', sub: `Enter the passcode to save the changes to ${plural(body.rows.length, 'item')}.`, go: 'Update items' },
        (h) => api<BulkItemsResult>('/items/bulk-update', { body, headers: h }));
      if (!ok) return;
      setConfirm(false);
      await Promise.all(['items', 'item', 'catalogue', 'brands', 'brand-series'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      setEdits({}); setCatTab({}); setChecked(false);
      showToast(`${plural(ok.value.updated, 'item')} updated`, 'ok');
    } catch (e) {
      setConfirm(false);
      const msg = e instanceof ApiError ? e.message : 'Could not update the items. Nothing was saved — try again.';
      setServerMsg(msg);
      // "<item name>: <reason>. Nothing was saved.": mark that item's cell
      const it = changedItems.find((i) => msg.startsWith(`${i.name}: `));
      if (it) {
        const f = fieldsOf(it).find((x) => (x === 'code' ? /code/i.test(msg) : x === 'category' ? /categor/i.test(msg) : x === 'gstRate' ? /tax|gst/i.test(msg) : new RegExp(x === 'sale' ? 'sale' : 'purchase', 'i').test(msg))) ?? fieldsOf(it)[0]!;
        setServerCell({ id: it.id, field: f, message: msg.slice(it.name.length + 2) });
        setTab(tabOf(it.id, f));
      }
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <>
      <button className="lnk" id="buBack" style={{ fontSize: 12, padding: 0 }} onClick={() => go('/items')}>← Products</button>
      <div className="pthd">
        <h1 className="ptkind" style={{ cursor: 'default' }}>Bulk Update Items</h1>
        <div className="pttot" id="buTot"><span>{plural(IT.length, 'item')}</span></div>
        <div className="sp"></div>
      </div>
    </>
  );
  if (list.isLoading) return <section id="vBulk">{header}</section>;

  const chip = BULK_TABS.map((t) => `${t.title} - ${n(counts[t.key])} ${counts[t.key] === 1 ? 'Update' : 'Updates'}`).join(', ');
  const bad = checked && badCount > 0;

  return (
    <section id="vBulk">
      {header}
      {bad && <div className="msg bad" id="buErr" role="alert">{plural(badCount, 'cell')} {badCount === 1 ? 'needs' : 'need'} fixing before Update: {[...problems.keys()].slice(0, 5).map((id) => byId.get(id)?.name).join(', ')}{problems.size > 5 ? ` and ${n(problems.size - 5)} more` : ''}. They are marked in red.</div>}
      {serverMsg && <div className="msg bad" id="buSrvErr" role="alert">{serverMsg}</div>}
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: '14px 16px', alignItems: 'center', gap: 18 }}>
          <label className="search" htmlFor="buQ" style={{ height: 34 }}><RawIcon d={SEARCH} /><input id="buQ" placeholder="Search by item name" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div role="radiogroup" aria-label="What to update" id="buTabs" style={{ display: 'flex', gap: 18 }}>
            {BULK_TABS.map((t) => (
              <label key={t.key} className="cb2"><input type="radio" name="buTab" value={t.key} data-bt={t.key} checked={tab === t.key} onChange={() => setTab(t.key)} />{t.title}</label>
            ))}
          </div>
        </div>
        {tab === 'pricing' && selRows.length > 0 && (
          <div className="ptfil" id="buSel" style={{ alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13 }}><b>{plural(selRows.length, 'item')} selected</b> <span className="mu">(No Tax : {n(noTax)})</span></span>
            <select className="fi" id="buTax" aria-label="Update tax slab of the selected items" value="" onChange={(e) => { const v = e.target.value; if (!v) return; for (const i of selRows) edit(i.id, 'gstRate', v); showToast(`Tax slab ${taxName(v)} set for ${plural(selRows.length, 'item')}. Press Update to save.`); }}>
              <option value="">Update Tax Slab</option>
              {taxes.map((t) => <option key={t.id} value={String(Number(t.rate))}>{t.name}{t.isOld ? ' (older rate)' : ''}</option>)}
            </select>
          </div>
        )}
        <EditGrid
          id="buGrid"
          columns={columns}
          rows={rows}
          rowKey={(i) => i.id}
          rowLabel={(i) => pos.get(i.id)}
          rowName={(i) => i.name}
          value={(i, k) => cell(i, k as BulkField)}
          onChange={(i, k, v) => edit(i.id, k as BulkField, v)}
          marks={(i, k) => {
            if (serverCell?.id === i.id && serverCell.field === k) return [{ level: 'error', message: serverCell.message }];
            const p = checked ? problems.get(i.id)?.[k as BulkField] : undefined;
            return p ? [{ level: 'error', message: p }] : undefined;
          }}
          note={(i, k) => (k === 'gstRate' && changed(i, 'gstRate') ? `was ${taxName(i.gstRate)}` : changed(i, k as BulkField) ? `was ${shown(i, k as BulkField) || '—'}` : undefined)}
          lead={{ title: 'Item name', fixed: 260, cell: (i) => i.name }}
          selection={{
            selected: sel,
            onToggle: (k, on) => setSel((x) => { const y = new Set(x); if (on) y.add(String(k)); else y.delete(String(k)); return y; }),
            onToggleAll: (on) => setSel((x) => { const y = new Set(x); for (const r of rows) if (on) y.add(r.id); else y.delete(r.id); return y; }),
          }}
          head={head}
          moveKeys
          filler
          empty={IT.length ? 'No items match.' : 'No items yet. Add items first.'}
        />
        <div className="egpg" id="buBar">
          <span><span className="brc" id="buChip" style={{ fontSize: 12, padding: '3px 10px' }}>{chip}</span></span>
          <button className="btn p" id="buGo" disabled={busy} onClick={update}>Update</button>
        </div>
      </div>
      <ThfPop anchor={pop?.anchor ?? null} onClose={() => setPop(null)} focus={pop && (pop.key === 'category' || pop.key === 'gstRate') ? 'button.on,button' : 'input,select'}>
        {pop && (pop.key === 'category' || pop.key === 'gstRate') ? (
          <ThfChoices
            options={[['', pop.key === 'category' ? 'All categories' : 'All tax slabs'], ...(pop.key === 'category' ? [['—', 'No category'] as [string, string], ...cats.map((c) => [c, c] as [string, string])] : taxes.map((t) => [String(Number(t.rate)), t.name] as [string, string]))]}
            value={(fx[pop.key] as string | undefined) ?? ''}
            onPick={(v) => setFilter(pop.key, v)}
          />
        ) : pop ? (
          <ColFilter key={pop.key} label={pop.key === 'lead' ? 'item name' : TITLES[pop.key].toLowerCase()} num={MONEY.includes(pop.key as BulkField)} cur={fx[pop.key]} onApply={(v) => setFilter(pop.key, v)} />
        ) : null}
      </ThfPop>
      {confirm && (
        <div className="ov c" id="buConfirm" onClick={(e) => { if ((e.target as HTMLElement).id === 'buConfirm' && !busy) setConfirm(false); }}>
          <ConfirmBody busy={busy} items={total} counts={counts} onCancel={() => setConfirm(false)} onGo={() => void save()} />
        </div>
      )}
    </section>
  );
}

/** A heading's text or amount filter, as the Sales list's (prototype thx). */
function ColFilter({ label, num, cur, onApply }: { label: string; num: boolean; cur: Filters['lead']; onApply: (v: string | NumF | null) => void }) {
  const f = cur && typeof cur === 'object' ? cur : null;
  const [v, setV] = useState(typeof cur === 'string' ? cur : '');
  const [op, setOp] = useState<NumF['op']>(f?.op ?? 'eq');
  const [a, setA] = useState(f ? String(f.a) : '');
  const [b, setB] = useState(f?.b != null ? String(f.b) : '');
  const [err, setErr] = useState('');
  const apply = (clear: boolean) => {
    if (clear) return onApply(null);
    if (!num) return onApply(v.trim());
    const x = parseInrAmount(a), y = parseInrAmount(b);
    if (!x) return setErr('Enter an amount.');
    if (op === 'bt' && !y) return setErr('Enter the second amount.');
    onApply({ op, a: Number(x), b: op === 'bt' ? Number(y) : null });
  };
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter' && /^(INPUT|SELECT)$/.test((e.target as HTMLElement).tagName)) { e.preventDefault(); apply(false); } };
  const foot = <><small className="neg" id="buFxErr">{err}</small><div className="thdb"><button type="button" className="btn sm" id="buFxClr" onClick={() => apply(true)}>Clear</button><button type="button" className="btn p sm" id="buFxOk" onClick={() => apply(false)}>Apply</button></div></>;
  return !num ? (
    <div className="thdr" onKeyDown={enter}><b>Filter by {label}</b><label>Contains<input className="fi" id="buFxV" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" /></label>{foot}</div>
  ) : (
    <div className="thdr" onKeyDown={enter}><b>Filter by {label}</b><label>Condition<select className="fi" id="buFxOp" value={op} onChange={(e) => setOp(e.target.value as NumF['op'])}>{OPS.map(([x, t]) => <option value={x} key={x}>{t}</option>)}</select></label>
      <div className="thx2"><label>Amount<input className="fi" id="buFxA" inputMode="decimal" autoComplete="off" value={a} onChange={(e) => setA(e.target.value)} /></label><label hidden={op !== 'bt'}>And<input className="fi" id="buFxB" inputMode="decimal" autoComplete="off" value={b} onChange={(e) => setB(e.target.value)} /></label></div>{foot}</div>
  );
}

function ConfirmBody({ busy, items, counts, onCancel, onGo }: { busy: boolean; items: number; counts: Record<BulkTab, number>; onCancel: () => void; onGo: () => void }) {
  useEscape(!busy, onCancel);
  return (
    <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bucT">
      <h3 id="bucT" style={{ margin: '0 0 12px', fontSize: 18 }}>Update {plural(items, 'item')}?</h3>
      <p id="bucD" style={{ margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.6 }}>{plural(counts.pricing, 'item')} pricing, {n(counts.info)} item information will change.</p>
      <p className="mu" style={{ margin: '0 0 14px', fontSize: 12.5, lineHeight: 1.6 }}>All of them are saved together. If one can’t be saved, none is, and you are told which one and why.</p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn" type="button" id="bucCancel" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="btn p" type="button" id="bucGo" disabled={busy} onClick={onGo}>{busy ? 'Updating…' : 'Update'}</button>
      </div>
    </div>
  );
}
