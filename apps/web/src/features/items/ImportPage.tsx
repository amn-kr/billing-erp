/**
 * Items › Import products (#vImport). Download the template, fill it in, upload it; every row is
 * checked and shown in an editable grid with the problems marked; nothing is saved until
 * Final import, which saves all rows in one go (or none). Not in the prototype — built only from
 * its classes (pthd, ptkind, pttot, seg2, card, ptfil, search, stt, msg, ov/mdl) and the EditGrid.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  checkImportRows, IMPORT_COLUMNS, IMPORT_MAX_ROWS, IMPORT_TYPES, parseImportDate, rowProblems,
  type ImportContext, type ImportKey, type ImportRow, type ImportSummary, type RowCheck,
} from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { go } from '../../lib/go';
import { saveFile } from '../../lib/files';
import { useEscape } from '../../lib/useEscape';
import { EditGrid, type GridColumn } from '../../components/EditGrid';
import { useDcf } from '../../components/Discard';
import { RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { errorRowsBlob, ImportFileError, readImportFile, templateBlob } from './importFile';
import { ui } from '../../styles/uiSize';

type Filter = 'all' | 'error' | 'warning' | 'ok';
type Result = { done: true; summary: ImportSummary } | { done: false; message: string; checks: RowCheck[] };

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
const DOWN = '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>';
const UP = '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>';
const n = (v: number) => v.toLocaleString('en-IN');
const plural = (c: number, w: string, ws = w + 's') => `${n(c)} ${c === 1 ? w : ws}`;
const STATUS = { ok: ['g', 'OK'], warning: ['a', 'Warning'], error: ['r', 'Error'] } as const;
const NUMS: ImportKey[] = ['qty', 'rate', 'sale', 'min', 'gst'];
const REQ: ImportKey[] = ['type', 'name', 'brand'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-04-01 → "01 Apr 2026", so a typed date can be checked at a glance */
const longDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d} ${MON[Number(m) - 1]} ${y}`; };
const uniq = (list: string[]) => [...new Map(list.map((v) => [v.toLowerCase(), v])).values()];

export function ImportPage() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const shop = useQuery({ queryKey: ['item-import-context'], queryFn: () => api<ImportContext>('/items/import/context'), staleTime: 0 });
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileErr, setFileErr] = useState('');
  const [reading, setReading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [skip, setSkip] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverMsg, setServerMsg] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const checks = useMemo(() => (rows && shop.data ? checkImportRows(rows, shop.data) : []), [rows, shop.data]);
  const byLine = useMemo(() => new Map(checks.map((c) => [c.line, c])), [checks]);
  const count = { all: checks.length, error: 0, warning: 0, ok: 0 };
  for (const c of checks) count[c.status]++;
  const importable = count.ok + count.warning;

  // leaving through the app (sidebar, ← Products) asks first: the rows being checked would be lost
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !!rows && !summary && currentLocation.pathname !== nextLocation.pathname);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let went = false;
    useDcf.getState().ask('import', () => { went = true; blockerRef.current.proceed?.(); });
    // "Keep editing" (or Esc) closes the question without going: stay on this page
    const stop = useDcf.subscribe((s) => { if (!s.what) { stop(); setTimeout(() => { if (!went) blockerRef.current.reset?.(); }, 0); } });
    return stop;
  }, [blocker.state]);

  // a page reload would lose the rows being checked
  useEffect(() => {
    if (!rows || summary) return;
    const stop = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [rows, summary]);

  async function download() {
    if (!shop.data) return;
    saveFile('Import products template.xlsx', await templateBlob(shop.data));
    showToast('Template downloaded');
  }

  async function upload(f: File) {
    setFileErr(''); setReading(true);
    try {
      const r = await readImportFile(f);
      setRows(r); setFileName(f.name); setFilter('all'); setQ(''); setSkip(false); setServerMsg(''); setSummary(null);
      await shop.refetch();
    } catch (e) {
      setFileErr(e instanceof ImportFileError ? e.message : 'This file could not be read. Download the template and copy your rows into it.');
    } finally {
      setReading(false);
    }
  }

  /** the rows with errors, and why (from the checks on screen, or from the import's summary) */
  async function downloadErrors(reasons: Map<number, string[]>) {
    if (!shop.data || !rows) return;
    const list = rows.filter((r) => reasons.has(r.line)).map((r) => ({ ...r, problem: reasons.get(r.line)!.join(' · ') }));
    saveFile('Import products - error rows.xlsx', await errorRowsBlob(shop.data, list));
  }

  async function finalImport() {
    if (!rows) return;
    setBusy(true); setServerMsg('');
    try {
      const r = await api<Result>('/items/import', { body: { rows, skipErrors: skip } });
      if (!r.done) {
        // the shop changed since the file was checked (e.g. an item was added): check again
        setConfirm(false); setServerMsg(r.message); await shop.refetch(); return;
      }
      setConfirm(false); setSummary(r.summary);
      await Promise.all(['items', 'item', 'catalogue', 'brands', 'brand-series', 'item-import-context'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`${plural(r.summary.created, 'product')} imported`);
    } catch (e) {
      setConfirm(false);
      setServerMsg(e instanceof ApiError ? e.message : 'Could not import. Nothing was saved — try again.');
    } finally {
      setBusy(false);
    }
  }

  const reset = () => { setRows(null); setSummary(null); setFileName(''); setServerMsg(''); };
  const header = (
    <>
      <button className="lnk" id="imBack" style={{ fontSize: ui.fs(12), padding: 0 }} onClick={() => go('/items')}>← Products</button>
      <div className="pthd">
        <h1 className="ptkind" style={{ cursor: 'default' }}>Import products</h1>
        {rows && <div className="pttot" id="imTot"><span>{fileName}</span><span>{plural(rows.length, 'row')}</span></div>}
        <div className="sp"></div>
        {rows && !summary && <>
          {count.error > 0 && <button className="btn" id="imErrDl" onClick={() => void downloadErrors(new Map(checks.filter((c) => c.status === 'error').map((c) => [c.line, rowProblems(c, 'error')])))}><RawIcon d={DOWN} />Download error rows</button>}
          <button className="btn" id="imOther" onClick={() => fileRef.current?.click()}><RawIcon d={UP} />Choose another file</button>
          <button className="btn p" id="imGo" disabled={!importable || (count.error > 0 && !skip)} onClick={() => setConfirm(true)}>Final import</button>
        </>}
      </div>
      <input type="file" id="imFile" accept=".xlsx" hidden ref={fileRef} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
    </>
  );

  if (summary) return <section id="vImport">{header}<Summary s={summary} onErrors={() => void downloadErrors(new Map(summary.skipped.map((x) => [x.line, x.reasons])))} onAgain={reset} /></section>;

  if (!rows || !shop.data) return (
    <section id="vImport">
      {header}
      <div className="card" id="imStart" style={{ padding: ui.sp('22px 24px'), maxWidth: 720 }}>
        <ol style={{ margin: ui.sp('0 0 18px'), paddingLeft: ui.sp(20), lineHeight: 1.9, fontSize: ui.fs(13.5) }}>
          <li><b>Download the template</b> — an Excel file with the columns in the right order and drop-down lists of your units, godowns, categories and GST rates. Its Notes sheet explains every column.</li>
          <li><b>Fill in your products</b> — one per row, up to {n(IMPORT_MAX_ROWS)} rows. Single Range for a single item; Multi Range for many brands and series under one product name.</li>
          <li><b>Upload it</b> — every row is checked and shown here. Correct anything marked, then press <b>Final import</b>. Nothing is saved before that.</li>
        </ol>
        <div style={{ display: 'flex', gap: ui.sp(10), flexWrap: 'wrap' }}>
          <button className="btn" id="imTpl" disabled={!shop.data} onClick={() => void download()}><RawIcon d={DOWN} />Download template</button>
          <button className="btn p" id="imUp" disabled={!shop.data || reading} onClick={() => fileRef.current?.click()}><RawIcon d={UP} />{reading ? 'Reading the file…' : 'Upload filled file'}</button>
        </div>
        <div className="msg bad" id="imFileErr" role="alert" style={{ marginTop: ui.sp(12) }}>{fileErr}</div>
      </div>
    </section>
  );

  const S = shop.data;
  const lists: Partial<Record<ImportKey, GridColumn['list']>> = {
    type: { options: [...IMPORT_TYPES] },
    unit: { options: S.units.map((u) => u.code) },
    godown: { options: S.godowns.map((g) => g.name) },
    gst: { options: S.gstRates },
    brand: { options: S.brands.map((b) => b.name), free: true },
    category: { options: S.categories, free: true },
  };
  const mainGodown = S.godowns.find((g) => g.isDefault)?.name ?? '';
  const columns: GridColumn[] = IMPORT_COLUMNS.map((c) => ({
    key: c.key, title: c.title, required: REQ.includes(c.key), num: NUMS.includes(c.key), list: lists[c.key],
    width: c.key === 'name' ? 270 : c.key === 'type' ? 150 : NUMS.includes(c.key) ? 110 : 150,
    placeholder: c.key === 'unit' ? 'PCS' : c.key === 'godown' ? mainGodown : c.key === 'gst' ? '18' : c.key === 'date' ? 'dd-mm-yyyy' : undefined,
  }));

  const s = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    const c = byLine.get(r.line);
    if (filter !== 'all' && c?.status !== filter) return false;
    return !s || [r.name, r.brand, r.series, r.code].some((v) => v.toLowerCase().includes(s));
  });
  const items = checks.flatMap((c) => (c.item ? [c.item] : []));
  const made = {
    brands: uniq(items.filter((i) => i.newBrand).map((i) => i.brand)),
    series: uniq(items.filter((i) => i.newSeries).map((i) => `${i.brand} ${i.series}`)),
    groups: uniq(items.filter((i) => i.newGroup).map((i) => i.group)),
    categories: uniq(items.filter((i) => i.newCategory).map((i) => i.category)),
  };
  const newBits = [
    made.groups.length && plural(made.groups.length, 'parent item'),
    made.brands.length && plural(made.brands.length, 'brand'),
    made.series.length && `${n(made.series.length)} series`,
    made.categories.length && plural(made.categories.length, 'category', 'categories'),
  ].filter(Boolean);
  const withStock = items.filter((i) => i.qty).length;

  return (
    <section id="vImport">
      {header}
      <div style={{ display: 'flex', alignItems: 'center', gap: ui.sp(14), flexWrap: 'wrap', margin: ui.sp('0 0 14px') }}>
        <div className="seg2" role="tablist" id="imTabs">
          {([['all', 'All'], ['error', 'Errors'], ['warning', 'Warnings'], ['ok', 'OK']] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} data-imf={k} onClick={() => setFilter(k)}>{t}<span>{n(count[k])}</span></button>
          ))}
        </div>
        <div id="imCount" style={{ fontSize: ui.fs(13), fontWeight: 600 }}>
          {!importable
            ? <span className="stt r">Nothing to import yet: every row has an error. Fix the errors first.</span>
            : count.error && !skip
            ? <span className="stt r">Fix {plural(count.error, 'row')} with errors, or tick “Skip error rows”.</span>
            : <span className="stt g">{plural(importable, 'product')} will be imported{count.error ? `, ${n(count.error)} skipped` : ''}.</span>}
        </div>
        {count.error > 0 && <label className="cb2" style={{ fontSize: ui.fs(13) }}><input type="checkbox" id="imSkip" checked={skip} onChange={(e) => setSkip(e.target.checked)} />Skip error rows</label>}
      </div>
      {serverMsg && <div className="msg bad" id="imSrvErr" role="alert">{serverMsg}</div>}

      <div className="card ptxc">
        <div className="ptfil" style={{ padding: ui.sp('14px 16px'), alignItems: 'center' }}>
          <label className="search" htmlFor="imQ" style={{ height: ui.h(34) }}><RawIcon d={SEARCH} /><input id="imQ" placeholder="Search product, brand, series or code" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {newBits.length > 0 && <span className="hint" id="imNew" style={{ margin: 0 }}>Will be created on import: {newBits.join(', ')}.</span>}
        </div>
        <EditGrid
          id="imGrid"
          columns={columns}
          rows={shown}
          rowKey={(r) => r.line}
          rowLabel={(r) => r.line}
          value={(r, k) => r[k as ImportKey]}
          onChange={(r, k, v) => setRows((list) => list!.map((x) => (x.line === r.line ? { ...x, [k]: v } : x)))}
          marks={(r, k) => byLine.get(r.line)?.cells[k as ImportKey]}
          note={(r, k) => { if (k !== 'date' || !r.date.trim()) return undefined; const d = parseImportDate(r.date); return d ? longDate(d) : undefined; }}
          lead={{ title: 'Status', width: 120, cell: (r) => {
            const c = byLine.get(r.line);
            const st = c?.status ?? 'ok';
            // the columns to look at, as the grid is wider than the screen
            const where = c && st === 'error' ? IMPORT_COLUMNS.filter((x) => c.cells[x.key]?.some((i) => i.level === 'error')).map((x) => x.title) : [];
            return <><span className={`stt ${STATUS[st][0]}`} data-st={st}>{STATUS[st][1]}</span>{where.length > 0 && <small className="egm bad" data-where style={{ padding: ui.sp('4px 0 0'), fontWeight: 500 }}>Check: {where.join(', ')}</small>}</>;
          } }}
          empty={filter === 'error' ? 'No rows with errors.' : filter === 'warning' ? 'No rows with warnings.' : 'No rows match.'}
        />
      </div>

      {confirm && (
        <div className="ov c" id="imConfirm" onClick={(e) => { if ((e.target as HTMLElement).id === 'imConfirm' && !busy) setConfirm(false); }}>
          <ConfirmBody busy={busy} count={importable} skipped={skip ? count.error : 0} withStock={withStock} newBits={newBits as string[]} onCancel={() => setConfirm(false)} onGo={() => void finalImport()} />
        </div>
      )}
    </section>
  );
}

function ConfirmBody({ busy, count, skipped, withStock, newBits, onCancel, onGo }: { busy: boolean; count: number; skipped: number; withStock: number; newBits: string[]; onCancel: () => void; onGo: () => void }) {
  useEscape(!busy, onCancel);
  return (
    <div className="mdl" role="dialog" aria-modal="true" aria-labelledby="imcT">
      <h3 id="imcT" style={{ margin: ui.sp('0 0 12px'), fontSize: ui.fs(18) }}>Import {plural(count, 'product')}?</h3>
      <ul style={{ margin: ui.sp('0 0 14px'), paddingLeft: ui.sp(18), lineHeight: 1.8, fontSize: ui.fs(13.5) }}>
        <li>{plural(count, 'product')} will be added{withStock ? `, ${n(withStock)} with opening stock` : ''}.</li>
        {newBits.length > 0 && <li>New: {newBits.join(', ')}.</li>}
        {skipped > 0 && <li>{plural(skipped, 'row')} with errors will be skipped.</li>}
        <li>Items are never deleted, only made inactive. Check the rows before you import.</li>
      </ul>
      <div style={{ display: 'flex', gap: ui.sp(10), justifyContent: 'flex-end' }}>
        <button className="btn" type="button" id="imcCancel" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="btn p" type="button" id="imcGo" disabled={busy} onClick={onGo}>{busy ? 'Importing…' : 'Final import'}</button>
      </div>
    </div>
  );
}

function Summary({ s, onErrors, onAgain }: { s: ImportSummary; onErrors: () => void; onAgain: () => void }) {
  const line = (t: string, list: string[]) => list.length > 0 && <li><b>{t}:</b> {list.slice(0, 20).join(', ')}{list.length > 20 ? ` and ${n(list.length - 20)} more` : ''}</li>;
  return (
    <div className="card" id="imDone" style={{ padding: ui.sp('22px 24px'), maxWidth: 820 }}>
      <h3 style={{ margin: ui.sp('0 0 12px'), fontSize: ui.fs(18) }}>Import finished</h3>
      <ul style={{ margin: ui.sp('0 0 14px'), paddingLeft: ui.sp(18), lineHeight: 1.9, fontSize: ui.fs(13.5) }}>
        <li><b>{plural(s.created, 'product')} created</b>{s.withStock ? `, ${n(s.withStock)} with opening stock` : ''}.</li>
        {line('New parent items', s.newGroups)}
        {line('New brands', s.newBrands)}
        {line('New series', s.newSeries)}
        {line('New categories', s.newCategories)}
        <li>{s.skipped.length ? <span className="stt r">{plural(s.skipped.length, 'row')} skipped because of errors:</span> : 'No rows were skipped.'}</li>
      </ul>
      {s.skipped.length > 0 && (
        <div className="tw" style={{ margin: ui.sp('0 0 14px'), maxHeight: ui.h(320), overflow: 'auto' }}>
          <table className="ptt2" id="imSkipped">
            <thead><tr><th>Row</th><th>Why it was skipped</th></tr></thead>
            <tbody>{s.skipped.map((x) => <tr key={x.line}><td>{x.line}</td><td style={{ whiteSpace: 'normal' }}>{x.reasons.join(' · ')}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: ui.sp(10), flexWrap: 'wrap' }}>
        {s.skipped.length > 0 && <button className="btn" id="imDoneErr" onClick={onErrors}><RawIcon d={DOWN} />Download error rows</button>}
        <button className="btn" id="imAgain" onClick={onAgain}>Import another file</button>
        <button className="btn p" id="imToItems" onClick={() => go('/items')}>Go to items</button>
      </div>
    </div>
  );
}
