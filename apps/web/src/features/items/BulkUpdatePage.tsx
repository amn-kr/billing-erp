/**
 * Items › ⋮ › Bulk update items (#vBulk). Every item in one spreadsheet-like table (SheetGrid):
 * Category, Item code, Description and Tax slab, edited in place; ticked rows can all get one tax
 * slab. Prices are changed in Price manager, not here. Nothing is saved until Update, which needs
 * every changed cell to be valid (a wrong value stays exactly as typed, marked red), asks once (and
 * for the edit passcode when it is on), then sends only the changed rows: the server saves all of
 * them or none. Stock comes back as a second tab later.
 * Not in the prototype — built only from its classes (pthd, ptkind, pttot, card, ptfil, search, brc,
 * stt, thf, thfp, thdr, msg, ov/mdl) and the grid's look (edit-grid.css), like Import products.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useBlocker } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BULK_FIELDS, bulkCellProblem, bulkSame, type BulkField, type BulkItemsInput, type BulkItemsResult } from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { go } from '../../lib/go';
import { useSettings } from '../../lib/settings';
import { useEscape } from '../../lib/useEscape';
import { SheetGrid, type SheetColumn, type SheetHandle } from '../../components/SheetGrid';
import { useDcf } from '../../components/Discard';
import { RawIcon } from '../../components/Icon';
import { ThfChoices, ThfPop, type ThfAnchor } from '../../components/ThfPop';
import { withPasscode } from '../settings/passcode';
import { useShell } from '../shell/store';
import type { Item } from './ItemsPage';
import { ui } from '../../styles/uiSize';

interface Row extends Item { description: string }
type Key = 'lead' | BulkField;
type Edits = Record<string, Partial<Record<BulkField, string>>>;

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const FILTER = '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>';
const n = (v: number) => v.toLocaleString('en-IN');
const plural = (c: number, w: string, ws = w + 's') => `${n(c)} ${c === 1 ? w : ws}`;
const TITLES: Record<Key, string> = { lead: 'Item name', category: 'Category', code: 'Item code', description: 'Description', gstRate: 'Tax slab' };
/** a saved value as its cell shows it */
const saved = (i: Row, f: BulkField) => (f === 'gstRate' ? String(Number(i.gstRate)) : i[f] ?? '');

export function BulkUpdatePage() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const list = useQuery({ queryKey: ['items'], queryFn: () => api<Row[]>('/items') });
  const cat = useQuery({ queryKey: ['catalogue'], queryFn: () => api<{ categories: { name: string }[] }>('/catalogue') });
  const taxList = useSettings().data?.taxes;
  const taxes = useMemo(() => (taxList ?? []).filter((t) => t.kind === 'GST'), [taxList]);
  const [q, setQ] = useState('');
  const [fx, setFx] = useState<Partial<Record<Key, string>>>({});
  const [pop, setPop] = useState<{ key: Key; anchor: ThfAnchor } | null>(null);
  const [edits, setEdits] = useState<Edits>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverMsg, setServerMsg] = useState('');
  /** the cell the server refused (item id and field) */
  const [serverCell, setServerCell] = useState<{ id: string; field: BulkField; message: string } | null>(null);
  /** a cell to go to once the rows are drawn (the first red one, after Update) */
  const [goTo, setGoTo] = useState<{ id: string; field: BulkField } | null>(null);
  const grid = useRef<SheetHandle | null>(null);

  const IT = useMemo(() => list.data ?? [], [list.data]);
  const rates = useMemo(() => [...new Set(taxes.map((t) => String(Number(t.rate))))], [taxes]);
  const taxName = (rate: string) => taxes.find((t) => Number(t.rate) === Number(rate))?.name ?? `GST ${Number(rate)}%`;
  const cell = (i: Row, f: BulkField) => edits[i.id]?.[f] ?? saved(i, f);
  const changed = (i: Row, f: BulkField) => { const t = edits[i.id]?.[f]; return t !== undefined && !bulkSame(f, saved(i, f), t); };
  const fieldsOf = (i: Row) => BULK_FIELDS.filter((f) => changed(i, f));

  /** the changed items, and the problems of their changed cells (shown at once, as they are typed) */
  const { changedItems, problems } = useMemo(() => {
    const codes = IT.map((i) => [i.id, (edits[i.id]?.code ?? i.code).trim().toLowerCase()] as const).filter(([, c]) => c);
    const codesBut = (id: string) => new Set(codes.filter(([x]) => x !== id).map(([, c]) => c));
    const items = IT.filter((i) => fieldsOf(i).length);
    const out = new Map<string, Partial<Record<BulkField, string>>>();
    for (const i of items) {
      for (const f of fieldsOf(i)) {
        const p = bulkCellProblem(f, edits[i.id]![f]!, f === 'code' ? codesBut(i.id) : new Set(), rates);
        if (p) out.set(i.id, { ...out.get(i.id), [f]: p });
      }
    }
    return { changedItems: items, problems: out };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [IT, edits, rates]);
  const badCount = [...problems.values()].reduce((a, p) => a + Object.keys(p).length, 0);
  /** only items whose every change is valid count as updates */
  const validItems = changedItems.filter((i) => !problems.has(i.id));
  const dirty = changedItems.length > 0;

  // leaving through the app asks first: the changes would be lost
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !busy && currentLocation.pathname !== nextLocation.pathname);
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
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [dirty]);

  const edit = (id: string, f: BulkField, v: string) => {
    setEdits((e) => ({ ...e, [id]: { ...e[id], [f]: v } }));
    if (serverCell?.id === id && serverCell.field === f) { setServerCell(null); setServerMsg(''); }
  };

  const cats = cat.data?.categories.map((c) => c.name) ?? [];
  const columns: SheetColumn[] = [
    { key: 'category', title: TITLES.category, width: 170, list: [{ value: '', label: 'No category' }, ...cats.map((c) => ({ value: c, label: c }))] },
    { key: 'code', title: TITLES.code, width: 150, placeholder: 'No code' },
    { key: 'description', title: TITLES.description, width: 180, grow: true, placeholder: 'Add a description' },
    { key: 'gstRate', title: TITLES.gstRate, width: 150, list: rates.map((r) => ({ value: r, label: taxName(r) })) },
  ];

  // search (item name) and the heading filters, on what the cells show now
  const s = q.trim().toLowerCase();
  const pass = (i: Row) => {
    if (s && !i.name.toLowerCase().includes(s)) return false;
    for (const [k, v] of Object.entries(fx) as [Key, string | undefined][]) {
      if (!v) continue;
      if (k === 'lead') { if (!i.name.toLowerCase().includes(v.toLowerCase())) return false; continue; }
      const text = cell(i, k);
      if (k === 'category') { if (text !== (v === '—' ? '' : v)) return false; }
      else if (k === 'gstRate') { if (Number(text) !== Number(v)) return false; }
      else if (!text.toLowerCase().includes(v.toLowerCase())) return false;
    }
    return true;
  };
  const rows = IT.filter(pass);
  const pos = useMemo(() => new Map(IT.map((i, k) => [i.id, k + 1])), [IT]);
  const selRows = IT.filter((i) => sel.has(i.id));
  const applied = (Object.entries(fx) as [Key, string | undefined][]).filter(([, v]) => !!v);
  const filterText = (k: Key, v: string) => (k === 'category' ? (v === '—' ? 'No category' : v) : k === 'gstRate' ? taxName(v) : `contains “${v}”`);

  const head = (key: string) => {
    const k = key as Key;
    if (!TITLES[k]) return null;
    const on = !!fx[k];
    const label = `Filter by ${TITLES[k].toLowerCase()}`;
    return <button type="button" className={`thf${on ? ' on' : ''}`} data-thf={`bu-${k}`} aria-label={on ? `${label} (filter on)` : label} title={on ? `Filter on: ${filterText(k, fx[k]!)}` : label} aria-haspopup="true" onClick={(e) => { e.stopPropagation(); setPop(pop?.key === k ? null : { key: k, anchor: { el: e.currentTarget, clamp: true } }); }}><RawIcon d={FILTER} /></button>;
  };
  const setFilter = (k: Key, v: string) => { setFx((f) => ({ ...f, [k]: v })); const el = pop?.anchor.el; setPop(null); el?.focus(); };

  // after Update with red cells (or a refused row): go to that cell once it is drawn
  useEffect(() => {
    if (!goTo || !rows.some((r) => r.id === goTo.id)) return;
    grid.current?.focusCell(goTo.id, goTo.field);
    setGoTo(null);
  });

  function update() {
    setServerMsg(''); setServerCell(null);
    if (badCount) {
      setTried(true);
      const first = IT.find((i) => problems.has(i.id))!;
      const field = BULK_FIELDS.find((f) => problems.get(first.id)![f])!;
      // a filter or the search may hide it
      if (!rows.some((r) => r.id === first.id)) { setQ(''); setFx({}); }
      setGoTo({ id: first.id, field });
      return;
    }
    if (!validItems.length) { showToast('Nothing has changed yet.'); return; }
    setConfirm(true);
  }

  async function save() {
    const body: BulkItemsInput = {
      rows: validItems.map((i) => {
        const r: BulkItemsInput['rows'][number] = { id: i.id };
        for (const f of fieldsOf(i)) {
          const t = edits[i.id]![f]!;
          if (f === 'gstRate') r.gstRate = Number(t);
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
      await Promise.all(['items', 'item', 'catalogue'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      setEdits({}); setTried(false);
      showToast(`${plural(ok.value.updated, 'item')} updated`, 'ok');
    } catch (e) {
      setConfirm(false);
      const msg = e instanceof ApiError ? e.message : 'Could not update the items. Nothing was saved — try again.';
      setServerMsg(msg);
      // "<item name>: <reason> Nothing was saved.": mark that item's cell
      const it = validItems.find((i) => msg.startsWith(`${i.name}: `));
      if (it) {
        const fs = fieldsOf(it);
        const f = fs.find((x) => (x === 'code' ? /code/i : x === 'category' ? /categor/i : x === 'description' ? /descri/i : /tax|gst/i).test(msg)) ?? fs[0]!;
        setServerCell({ id: it.id, field: f, message: msg.slice(it.name.length + 2).replace(/ Nothing was saved\.$/, '') });
        setGoTo({ id: it.id, field: f });
      }
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <>
      <button className="lnk" id="buBack" style={{ fontSize: ui.fs(12), padding: 0 }} onClick={() => go('/items')}>← Items</button>
      <div className="pthd">
        <h1 className="ptkind" style={{ cursor: 'default' }}>Bulk Update Items</h1>
        <div className="pttot" id="buTot"><span>{plural(IT.length, 'item')}</span></div>
        <div className="sp"></div>
      </div>
    </>
  );
  if (list.isLoading) return <section id="vBulk">{header}</section>;

  const badNames = IT.filter((i) => problems.has(i.id)).map((i) => i.name);
  return (
    <section id="vBulk">
      {header}
      {tried && badCount > 0 && <div className="msg bad" id="buErr" role="alert">{plural(badCount, 'cell')} {badCount === 1 ? 'needs' : 'need'} fixing before Update: {badNames.slice(0, 5).join(', ')}{badNames.length > 5 ? ` and ${n(badNames.length - 5)} more` : ''}. {badCount === 1 ? 'It is' : 'They are'} marked in red.</div>}
      {serverMsg && <div className="msg bad" id="buSrvErr" role="alert">{serverMsg}</div>}
      <div className="card ptxc">
        <div className="ptfil" style={{ padding: ui.sp('14px 16px'), alignItems: 'center', gap: ui.sp(12) }}>
          <label className="search" htmlFor="buQ" style={{ height: ui.h(34) }}><RawIcon d={SEARCH} /><input id="buQ" placeholder="Search by item name" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {applied.length > 0 && (
            <span id="buFilters" style={{ display: 'inline-flex', alignItems: 'center', gap: ui.sp(8), fontSize: ui.fs(12.5) }}>
              <span className="brc" id="buFilterOn">Filter on</span>
              <span className="mu" id="buFilterWhat">{applied.map(([k, v]) => `${TITLES[k]}: ${filterText(k, v!)}`).join(' · ')}</span>
              <button type="button" className="lnk" id="buFilterClr" onClick={() => setFx({})}>Clear filter{applied.length > 1 ? 's' : ''}</button>
            </span>
          )}
          {selRows.length > 0 && (
            <span id="buSel" style={{ display: 'inline-flex', alignItems: 'center', gap: ui.sp(10), marginLeft: 'auto', fontSize: ui.fs(13) }}>
              <b>{plural(selRows.length, 'item')} selected</b>
              <select className="fi" id="buTax" aria-label="Update tax slab of the selected items" value="" style={{ width: 'auto', height: ui.h(34), margin: 0 }} onChange={(e) => { const v = e.target.value; if (!v) return; for (const i of selRows) edit(i.id, 'gstRate', v); showToast(`Tax slab ${taxName(v)} set for ${plural(selRows.length, 'item')}. Press Update to save.`); }}>
                <option value="">Update Tax Slab</option>
                {taxes.map((t) => <option key={t.id} value={String(Number(t.rate))}>{t.name}{t.isOld ? ' (older rate)' : ''}</option>)}
              </select>
            </span>
          )}
        </div>
        <SheetGrid
          id="buGrid"
          handle={grid}
          columns={columns}
          rows={rows}
          rowKey={(i) => i.id}
          rowLabel={(i) => pos.get(i.id)}
          rowName={(i) => i.name}
          lead={{ title: TITLES.lead, width: 220, cell: (i) => i.name }}
          value={(i, k) => cell(i, k as BulkField)}
          onChange={(i, k, v) => edit(i.id, k as BulkField, v)}
          mark={(i, k) => {
            const f = k as BulkField;
            const srv = serverCell?.id === i.id && serverCell.field === f;
            if (!srv && !changed(i, f)) return undefined;
            const was = `was ${f === 'gstRate' ? taxName(i.gstRate) : saved(i, f) || '—'}`;
            const p = srv ? serverCell!.message : problems.get(i.id)?.[f];
            return p ? { error: p, hint: was } : { hint: was };
          }}
          selection={{
            selected: sel,
            onToggle: (k, on) => setSel((x) => { const y = new Set(x); if (on) y.add(k); else y.delete(k); return y; }),
            onToggleAll: (on) => setSel((x) => { const y = new Set(x); for (const r of rows) if (on) y.add(r.id); else y.delete(r.id); return y; }),
          }}
          head={head}
          empty={IT.length ? 'No items match.' : 'No items yet. Add items first.'}
        />
        <div className="egpg" id="buBar">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: ui.sp(10) }}>
            <span className="brc" id="buChip" style={{ fontSize: ui.fs(12), padding: ui.sp('3px 10px') }}>Item Information - {plural(validItems.length, 'Update')}</span>
            {badCount > 0 && <span className="stt r" id="buErrCount">{plural(badCount, 'error')}</span>}
          </span>
          <button className="btn p" id="buGo" disabled={busy} onClick={update}>Update</button>
        </div>
      </div>
      <ThfPop anchor={pop?.anchor ?? null} onClose={() => setPop(null)} focus={pop && (pop.key === 'category' || pop.key === 'gstRate') ? 'button.on,button' : 'input'}>
        {pop && (pop.key === 'category' || pop.key === 'gstRate') ? (
          <ThfChoices
            options={[['', pop.key === 'category' ? 'All categories' : 'All tax slabs'], ...(pop.key === 'category' ? [['—', 'No category'] as [string, string], ...cats.map((c) => [c, c] as [string, string])] : rates.map((r) => [r, taxName(r)] as [string, string]))]}
            value={fx[pop.key] ?? ''}
            onPick={(v) => setFilter(pop.key, v)}
          />
        ) : pop ? (
          <TextFilter key={pop.key} label={TITLES[pop.key].toLowerCase()} cur={fx[pop.key] ?? ''} onApply={(v) => setFilter(pop.key, v)} />
        ) : null}
      </ThfPop>
      {confirm && (
        <div className="ov c" id="buConfirm" onClick={(e) => { if ((e.target as HTMLElement).id === 'buConfirm' && !busy) setConfirm(false); }}>
          <ConfirmBody busy={busy} items={validItems.length} onCancel={() => setConfirm(false)} onGo={() => void save()} />
        </div>
      )}
    </section>
  );
}

/** A heading's text filter, as the Sales list's (prototype thx). */
function TextFilter({ label, cur, onApply }: { label: string; cur: string; onApply: (v: string) => void }) {
  const [v, setV] = useState(cur);
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onApply(v.trim()); } };
  return (
    <div className="thdr" onKeyDown={enter}><b>Filter by {label}</b><label>Contains<input className="fi" id="buFxV" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" /></label>
      <div className="thdb"><button type="button" className="btn sm" id="buFxClr" onClick={() => onApply('')}>Clear</button><button type="button" className="btn p sm" id="buFxOk" onClick={() => onApply(v.trim())}>Apply</button></div></div>
  );
}

function ConfirmBody({ busy, items, onCancel, onGo }: { busy: boolean; items: number; onCancel: () => void; onGo: () => void }) {
  useEscape(!busy, onCancel);
  return (
    <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="bucT">
      <h3 id="bucT" style={{ margin: ui.sp('0 0 12px'), fontSize: ui.fs(18) }}>Update {plural(items, 'item')}?</h3>
      <p id="bucD" style={{ margin: ui.sp('0 0 8px'), fontSize: ui.fs(13.5), lineHeight: 1.6 }}>The item information of {plural(items, 'item')} will change.</p>
      <p className="mu" style={{ margin: ui.sp('0 0 14px'), fontSize: ui.fs(12.5), lineHeight: 1.6 }}>All of them are saved together. If one can’t be saved, none is, and you are told which one and why.</p>
      <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end' }}>
        <button className="btn" type="button" id="bucCancel" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="btn p" type="button" id="bucGo" disabled={busy} onClick={onGo}>{busy ? 'Updating…' : 'Update'}</button>
      </div>
    </div>
  );
}
