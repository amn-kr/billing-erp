/**
 * Parties › Import Parties › Bulk entry (#vPBulk). A spreadsheet-like table (SheetGrid, as on Bulk
 * update items) with the import columns and 10 empty rows to start. Type in the cells (Tab / Enter
 * move), or paste a block copied from Excel or Google Sheets: rows are added as needed and a heading
 * row is recognised and left out. Every row is checked as it changes (the same checks as the Excel
 * import and the server): a wrong cell turns red with the reason, duplicates are marked. Save all
 * saves the OK rows; rows with problems stay so they can be fixed and saved again.
 * Not in the prototype — built only from its classes (lnk, pthd, ptkind, pttot, card, ptxc, btn, ixs,
 * stt, msg, hint) and the grid's look (edit-grid.css, sheet-grid.css), like Bulk update items.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BALANCE_TYPES, checkPartyRows, isBlankPartyRow, PARTY_IMPORT_COLUMNS, PARTY_IMPORT_KEYS, PARTY_IMPORT_MAX_ROWS, PARTY_TYPES, partyRowProblems,
  readPasted, STATES, stateCodeOf, stateName,
  type PartyImportContext, type PartyImportKey, type PartyImportRow, type PartyImportSummary,
} from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { RawIcon } from '../../components/Icon';
import { SheetGrid, type SheetColumn, type SheetHandle, type SheetMark } from '../../components/SheetGrid';
import { useShell } from '../shell/store';
import { ImportHead, num, PARTY_QUERIES, plural, STATUS, Summary, useKeepRows } from './importParts';
import { ui } from '../../styles/uiSize';

type Cells = Record<PartyImportKey, string>;
interface Row { key: string; cells: Cells }

const START_ROWS = 10;
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const X = '<path d="M6 6l12 12M18 6L6 18"/>';
let seq = 0;
const blankRow = (): Row => ({ key: `r${++seq}`, cells: Object.fromEntries(PARTY_IMPORT_KEYS.map((k) => [k, ''])) as Cells });
const blankRows = (n: number) => Array.from({ length: n }, blankRow);
const low = (s: string) => s.trim().toLowerCase();

/** A typed or pasted value as its drop-down shows it ("supplier" → Supplier, "To collect" → To receive, "27" → Maharashtra); anything else stays as typed, to be marked. */
function fit(k: PartyImportKey, v: string): string {
  const s = v.trim();
  if (!s) return '';
  if (k === 'type') return PARTY_TYPES.find((t) => low(t) === low(s)) ?? s;
  if (k === 'balType') return low(s) === 'to collect' ? 'To receive' : BALANCE_TYPES.find((t) => low(t) === low(s)) ?? s;
  if (k === 'state') { const c = stateCodeOf(s); return c ? stateName(c) : s; }
  return s;
}

const WIDTH: Record<PartyImportKey, number> = { name: 220, type: 130, phone: 140, email: 200, gstin: 180, address: 230, city: 130, state: 180, opening: 140, balType: 140, limit: 130 };
const opts = (list: readonly string[]) => [{ value: '', label: '—' }, ...list.map((v) => ({ value: v, label: v }))];
const COLUMNS: SheetColumn[] = PARTY_IMPORT_COLUMNS.map((c) => ({
  key: c.key, title: c.title, width: WIDTH[c.key],
  list: c.key === 'type' ? opts(PARTY_TYPES) : c.key === 'balType' ? opts(BALANCE_TYPES) : c.key === 'state' ? opts(STATES.map(([, n]) => n)) : undefined,
  placeholder: c.key === 'type' ? 'Customer' : undefined,
}));

export function BulkEntryPage() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const shop = useQuery({ queryKey: ['party-import-context'], queryFn: () => api<PartyImportContext>('/parties/import/context'), staleTime: 0 });
  const [rows, setRows] = useState<Row[]>(() => blankRows(START_ROWS));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [summary, setSummary] = useState<PartyImportSummary | null>(null);
  const grid = useRef<SheetHandle | null>(null);

  /** the rows as the checker and the server see them: line = the row's number in the table */
  const asRows = (list: Row[]): PartyImportRow[] => list.map((r, i) => ({ line: i + 1, ...r.cells }));
  const checks = useMemo(() => (shop.data ? checkPartyRows(asRows(rows), shop.data) : []), [rows, shop.data]);
  const byLine = useMemo(() => new Map(checks.map((c) => [c.line, c])), [checks]);
  const lineOf = useMemo(() => new Map(rows.map((r, i) => [r.key, i + 1])), [rows]);
  const filled = checks.length;
  const ok = checks.filter((c) => c.status === 'ok').length;
  const problems = checks.filter((c) => c.status !== 'ok');
  const tooMany = filled > PARTY_IMPORT_MAX_ROWS;
  useKeepRows(rows.some((r) => !isBlankPartyRow(r.cells)));

  const setCell = (key: string, k: PartyImportKey, v: string) => setRows((list) => list.map((r) => (r.key === key ? { ...r, cells: { ...r.cells, [k]: v } } : r)));
  const addRow = () => {
    const r = blankRow();
    setRows((list) => [...list, r]);
    setTimeout(() => grid.current?.focusCell(r.key, 'name'), 0);
  };
  const removeRow = (key: string) => setRows((list) => { const next = list.filter((r) => r.key !== key); return next.length ? next : blankRows(1); });

  /** a block pasted at a cell: fills from there to the right and down, adding rows as needed */
  function paste(at: string, col: string, text: string) {
    const p = readPasted(text);
    const blocks: Partial<Cells>[] = p.header
      ? p.cells
      : p.cells.map((cells) => {
          const from = PARTY_IMPORT_KEYS.indexOf(col as PartyImportKey);
          return Object.fromEntries(cells.slice(0, PARTY_IMPORT_KEYS.length - from).map((v, i) => [PARTY_IMPORT_KEYS[from + i]!, v]));
        });
    if (!blocks.length) return;
    setRows((list) => {
      const start = list.findIndex((r) => r.key === at);
      const room = PARTY_IMPORT_MAX_ROWS - start;
      const use = blocks.slice(0, Math.max(0, room));
      if (use.length < blocks.length) showToast(`Only ${num(PARTY_IMPORT_MAX_ROWS)} rows can be saved at once: ${num(blocks.length - use.length)} pasted rows were left out`);
      const next = [...list];
      while (next.length < start + use.length) next.push(blankRow());
      use.forEach((b, i) => {
        const r = next[start + i]!;
        const cells = { ...r.cells };
        for (const [k, v] of Object.entries(b) as [PartyImportKey, string][]) cells[k] = fit(k, v);
        next[start + i] = { ...r, cells };
      });
      return next;
    });
    showToast(`${plural(blocks.length, 'row')} pasted${p.header ? ' (heading row left out)' : ''}`);
  }

  async function saveAll() {
    const list = rows;
    const send = asRows(list).filter((r) => !isBlankPartyRow(r));
    if (!send.length) return;
    setBusy(true); setMsg('');
    try {
      const s = await api<PartyImportSummary>('/parties/import', { body: { rows: send } });
      const saved = new Set(s.saved.map((x) => x.line));
      // saved rows leave the table; rows with problems stay to be fixed and saved again
      setRows(() => { const left = list.filter((_, i) => !saved.has(i + 1) && !isBlankPartyRow(list[i]!.cells)); return left.length ? [...left, ...blankRows(Math.max(0, START_ROWS - left.length))] : blankRows(START_ROWS); });
      setSummary(s);
      await Promise.all(PARTY_QUERIES.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`${plural(s.saved.length, 'party', 'parties')} saved`);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Could not save. Nothing was saved — try again.');
    } finally {
      setBusy(false);
    }
  }

  const mark = (r: Row, k: string): SheetMark | undefined => {
    const c = byLine.get(lineOf.get(r.key)!);
    const m = c?.cells[k as PartyImportKey]?.[0];
    if (m) return { error: m, hint: m };
    // a duplicate: its name (or phone) cell says why
    if (c?.status === 'duplicate' && (k === 'name' || (k === 'phone' && c.cells.row?.some((x) => /phone/i.test(x))))) { const why = c.cells.row!.join(' '); return { error: why, hint: why }; }
    return undefined;
  };

  return (
    <section id="vPBulk">
      <ImportHead back="choice">
        <h1 className="ptkind" style={{ cursor: 'default' }}>Bulk entry</h1>
        <div className="pttot" id="pbTot">
          <span><i style={{ background: 'var(--green)' }}></i>OK <b id="pbOk">{num(ok)}</b></span>
          <span><i style={{ background: 'var(--red)' }}></i>Problems <b id="pbBad">{num(problems.length)}</b></span>
        </div>
        <div className="sp"></div>
        <button className="btn" id="pbAdd" onClick={addRow}><RawIcon d={PLUS} />Add row</button>
        <button className="btn p" id="pbSave" disabled={!ok || busy || tooMany} onClick={() => void saveAll()}>{busy ? 'Saving…' : ok ? `Save all (${plural(ok, 'party', 'parties')})` : 'Save all'}</button>
      </ImportHead>
      <p className="hint" style={{ margin: ui.sp('0 0 12px') }}>Type parties in the table, or copy rows from Excel or Google Sheets and paste them into a cell (Ctrl+V). Rows with a problem are not saved.</p>
      {tooMany && <div className="msg bad" role="alert" id="pbTooMany">At most {num(PARTY_IMPORT_MAX_ROWS)} parties can be saved at once. Remove some rows first.</div>}
      {msg && <div className="msg bad" role="alert" id="pbErr">{msg}</div>}
      {summary && <div style={{ margin: ui.sp('0 0 14px') }}><Summary s={summary} counts again={() => setSummary(null)} againLabel="Enter more parties" /></div>}

      <div className="card ptxc">
        <SheetGrid
          id="pbGrid"
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.key}
          rowLabel={(r) => lineOf.get(r.key)}
          rowName={(r) => r.cells.name || `row ${lineOf.get(r.key)}`}
          value={(r, k) => r.cells[k as PartyImportKey]}
          onChange={(r, k, v) => setCell(r.key, k as PartyImportKey, v)}
          mark={mark}
          onPaste={paste}
          handle={grid}
          tail={{ title: 'Status', width: 210, cell: (r) => {
            const c = byLine.get(lineOf.get(r.key)!);
            return (
              <span style={{ display: 'flex', alignItems: 'center', gap: ui.sp(8), justifyContent: 'space-between' }}>
                {c ? <span className={`stt ${STATUS[c.status][0]}`} data-st={c.status}>{STATUS[c.status][1]}</span> : <span></span>}
                <button className="ixs" type="button" data-remove={lineOf.get(r.key)} aria-label={`Remove row ${lineOf.get(r.key)}`} title="Remove row" onClick={() => removeRow(r.key)}><RawIcon d={X} /></button>
              </span>
            );
          } }}
        />
      </div>

      {problems.length > 0 && (
        <div className="card" id="pbProblems" style={{ padding: ui.sp('14px 16px'), marginTop: ui.sp(14) }}>
          <h3 style={{ margin: ui.sp('0 0 8px'), fontSize: ui.fs(14) }}>{plural(problems.length, 'row')} will not be saved</h3>
          <ul style={{ margin: 0, paddingLeft: ui.sp(18), lineHeight: 1.8, fontSize: ui.fs(13) }}>
            {problems.map((c) => <li key={c.line} data-line={c.line}><b>Row {c.line}</b> · <span className={`stt ${STATUS[c.status][0]}`}>{STATUS[c.status][1]}</span> · {partyRowProblems(c).join(' · ')}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
