/**
 * Parties › Import Parties › Import from Excel (#vPExcel). Download the sample file, fill it in,
 * upload it (.xlsx or .csv); every row is checked and shown with its status (OK / Rejected /
 * Duplicate - skipped) before anything is saved. "Import N parties" saves only the OK rows, then a
 * summary shows what was saved. Not in the prototype — built only from its classes (lnk, pthd,
 * ptkind, pttot, seg2, card, ptfil, tw, ptt2, stt, msg, hint), like Import products.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  checkPartyRows, PARTY_IMPORT_COLUMNS, PARTY_IMPORT_MAX_ROWS, partyRowProblems,
  type PartyImportContext, type PartyImportKey, type PartyImportRow, type PartyImportSummary, type PartyRowStatus,
} from '@billing/shared';
import { api, ApiError } from '../../lib/api';
import { saveFile } from '../../lib/files';
import { RawIcon } from '../../components/Icon';
import { useShell } from '../shell/store';
import { DOWN, ImportHead, num, PARTY_QUERIES, plural, STATUS, Summary, UP, useKeepRows } from './importParts';
import { PartyFileError, readPartyFile, rejectedBlob, sampleBlob } from './partyFile';
import { ui } from '../../styles/uiSize';

type Filter = 'all' | PartyRowStatus;

export function ImportExcelPage() {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const shop = useQuery({ queryKey: ['party-import-context'], queryFn: () => api<PartyImportContext>('/parties/import/context'), staleTime: 0 });
  const [rows, setRows] = useState<PartyImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileErr, setFileErr] = useState('');
  const [reading, setReading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [serverMsg, setServerMsg] = useState('');
  const [summary, setSummary] = useState<PartyImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const checks = useMemo(() => (rows && shop.data ? checkPartyRows(rows, shop.data) : []), [rows, shop.data]);
  const byLine = useMemo(() => new Map(checks.map((c) => [c.line, c])), [checks]);
  const count = { all: checks.length, ok: 0, rejected: 0, duplicate: 0, example: 0 };
  for (const c of checks) count[c.status]++;
  useKeepRows(!!rows && !summary);

  async function download() {
    saveFile('Import parties sample.xlsx', await sampleBlob());
    showToast('Sample file downloaded');
  }

  async function upload(f: File) {
    setFileErr(''); setReading(true);
    try {
      const r = await readPartyFile(f);
      await shop.refetch();
      setRows(r); setFileName(f.name); setFilter('all'); setServerMsg(''); setSummary(null);
    } catch (e) {
      setFileErr(e instanceof PartyFileError ? e.message : 'This file could not be read. Download the sample file and copy your rows into it.');
    } finally {
      setReading(false);
    }
  }

  /** the rejected rows as typed, with why, to fix and upload again */
  async function downloadRejected(reasons: Map<number, string[]>) {
    if (!rows) return;
    const list = rows.filter((r) => reasons.has(r.line)).map((r) => ({ ...r, problem: reasons.get(r.line)!.join(' · ') }));
    saveFile('Import parties - rejected rows.xlsx', await rejectedBlob(list));
  }

  async function save() {
    if (!rows) return;
    setBusy(true); setServerMsg('');
    try {
      const s = await api<PartyImportSummary>('/parties/import', { body: { rows } });
      setSummary(s);
      await Promise.all(PARTY_QUERIES.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      showToast(`${plural(s.saved.length, 'party', 'parties')} imported`);
    } catch (e) {
      setServerMsg(e instanceof ApiError ? e.message : 'Could not import. Nothing was saved — try again.');
    } finally {
      setBusy(false);
    }
  }

  const reset = () => { setRows(null); setSummary(null); setFileName(''); setServerMsg(''); };
  const header = (
    <>
      <ImportHead back="choice">
        <h1 className="ptkind" style={{ cursor: 'default' }}>Import from Excel</h1>
        {rows && <div className="pttot" id="pxTot"><span>{fileName}</span><span>{plural(rows.length, 'row')}</span></div>}
        <div className="sp"></div>
        {rows && !summary && <>
          {count.rejected > 0 && <button className="btn" id="pxRejDl" onClick={() => void downloadRejected(new Map(checks.filter((c) => c.status === 'rejected').map((c) => [c.line, partyRowProblems(c)])))}><RawIcon d={DOWN} />Download rejected rows</button>}
          <button className="btn" id="pxOther" onClick={() => fileRef.current?.click()}><RawIcon d={UP} />Choose another file</button>
          <button className="btn p" id="pxGo" disabled={!count.ok || busy} onClick={() => void save()}>{busy ? 'Importing…' : `Import ${plural(count.ok, 'party', 'parties')}`}</button>
        </>}
      </ImportHead>
      <input type="file" id="pxFile" accept=".xlsx,.csv" hidden ref={fileRef} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
    </>
  );

  if (summary) return <section id="vPExcel">{header}<Summary s={summary} onRejected={() => void downloadRejected(new Map(summary.rejected.map((x) => [x.line, x.reasons])))} again={reset} againLabel="Import another file" /></section>;

  if (!rows || !shop.data) return (
    <section id="vPExcel">
      {header}
      <div className="card" id="pxStart" style={{ padding: ui.sp('22px 24px'), maxWidth: 720 }}>
        <ol style={{ margin: ui.sp('0 0 18px'), paddingLeft: ui.sp(20), lineHeight: 1.9, fontSize: ui.fs(13.5) }}>
          <li><b>Download the sample file</b>: an Excel file with the column headings, one example row and drop-down lists. Its Instructions sheet explains every column.</li>
          <li><b>Fill in your parties</b>: one per row, up to {num(PARTY_IMPORT_MAX_ROWS)} rows. Only Party name is required.</li>
          <li><b>Upload it</b> (.xlsx or .csv): every row is checked and shown here. Then press <b>Import</b> to save the OK rows. Nothing is saved before that.</li>
        </ol>
        <div style={{ display: 'flex', gap: ui.sp(10), flexWrap: 'wrap' }}>
          <button className="btn" id="pxSample" onClick={() => void download()}><RawIcon d={DOWN} />Download sample file</button>
          <button className="btn p" id="pxUp" disabled={!shop.data || reading} onClick={() => fileRef.current?.click()}><RawIcon d={UP} />{reading ? 'Reading the file…' : 'Upload file'}</button>
        </div>
        <div className="msg bad" id="pxFileErr" role="alert" style={{ marginTop: ui.sp(12) }}>{fileErr}</div>
      </div>
    </section>
  );

  const shown = checks.filter((c) => filter === 'all' || c.status === filter);
  const rowOf = new Map(rows.map((r) => [r.line, r]));
  return (
    <section id="vPExcel">
      {header}
      <div style={{ display: 'flex', alignItems: 'center', gap: ui.sp(14), flexWrap: 'wrap', margin: ui.sp('0 0 14px') }}>
        <div className="seg2" role="tablist" id="pxTabs">
          {([['all', 'All'], ['ok', 'Ready'], ['rejected', 'Rejected'], ['duplicate', 'Duplicates']] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} data-pxf={k} onClick={() => setFilter(k)}>{t}<span>{num(count[k])}</span></button>
          ))}
        </div>
        <div id="pxCount" style={{ fontSize: ui.fs(13), fontWeight: 600 }}>
          {count.ok
            ? <span className="stt g">{plural(count.ok, 'party', 'parties')} ready to import{count.rejected || count.duplicate + count.example ? `; ${num(count.rejected)} rejected and ${num(count.duplicate + count.example)} skipped rows will not be saved` : ''}.</span>
            : <span className="stt r">{count.example && count.example === count.all ? 'Nothing to import: the file only has the example row. Add your own parties and upload it again.' : 'Nothing to import: no row is OK. Fix the file and upload it again.'}</span>}
        </div>
      </div>
      {serverMsg && <div className="msg bad" id="pxSrvErr" role="alert">{serverMsg}</div>}

      <div className="card ptxc">
        <div className="tw" style={{ margin: 0, maxHeight: ui.h('calc(100vh - 290px)'), overflow: 'auto' }}>
          <table className="ptt2" id="pxGrid">
            <thead><tr><th>Row</th><th>Status</th><th>Reason</th>{PARTY_IMPORT_COLUMNS.map((c) => <th key={c.key} className={c.key === 'opening' || c.key === 'limit' ? 'n' : undefined}>{c.title}</th>)}</tr></thead>
            <tbody>
              {shown.length ? shown.map((c) => {
                const r = rowOf.get(c.line)!;
                const bad = (k: PartyImportKey) => (c.cells[k]?.length ? 'neg' : undefined);
                return (
                  <tr key={c.line} data-row={c.line} data-st={c.status}>
                    <td>{c.line}</td>
                    <td><span className={`stt ${STATUS[c.status][0]}`}>{STATUS[c.status][1]}</span></td>
                    <td data-col="reason" style={{ whiteSpace: 'normal', minWidth: 240, maxWidth: 340 }} className={c.status === 'rejected' ? 'neg' : undefined}>{partyRowProblems(c).join(' · ')}</td>
                    {PARTY_IMPORT_COLUMNS.map((x) => <td key={x.key} data-col={x.key} className={[x.key === 'opening' || x.key === 'limit' ? 'n' : '', bad(x.key) ?? ''].join(' ').trim() || undefined} title={c.cells[x.key]?.join(' ')}>{r[x.key]}</td>)}
                  </tr>
                );
              }) : <tr><td colSpan={PARTY_IMPORT_COLUMNS.length + 3} className="ptempty">{filter === 'rejected' ? 'No rejected rows.' : filter === 'duplicate' ? 'No duplicates.' : 'No rows.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
