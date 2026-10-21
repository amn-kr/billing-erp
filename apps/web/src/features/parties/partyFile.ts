/**
 * Parties › Import Parties › Import from Excel: the sample file (Parties sheet with the headings,
 * one example row and drop-down lists, plus an Instructions sheet), the "rejected rows" file (the
 * same sheet + a Problem column) and reading an uploaded .xlsx or .csv back. Columns are found by
 * their heading (any order, capital letters and extra spaces do not matter).
 */
import {
  BALANCE_TYPES, PARTY_IMPORT_COLUMNS, PARTY_IMPORT_KEYS, PARTY_IMPORT_MAX_BYTES, PARTY_IMPORT_MAX_ROWS, PARTY_IMPORT_PROBLEM_COLUMN,
  PARTY_EXAMPLE_ROW, PARTY_IMPORT_SHEET, PARTY_TYPES, STATES, isBlankPartyRow, partyColumnOf, splitPasted, type PartyImportKey, type PartyImportRow,
} from '@billing/shared';
import type { Workbook, Worksheet, CellValue, DataValidation } from 'exceljs';

/** exceljs has drop-down lists for whole ranges (one rule per range), missing from its type file */
const validations = (ws: Worksheet) => (ws as Worksheet & { dataValidations: { add(range: string, v: DataValidation): void } }).dataValidations;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE3F3F0' } };
const WIDTHS: Record<PartyImportKey, number> = { name: 30, type: 13, phone: 14, email: 26, gstin: 19, address: 34, city: 16, state: 20, opening: 16, balType: 14, limit: 13 };
const LAST_ROW = PARTY_IMPORT_MAX_ROWS + 1;
const NUM_KEYS: PartyImportKey[] = ['opening', 'limit'];
const col = (i: number) => String.fromCharCode(65 + i);
const colOf = (k: PartyImportKey) => col(PARTY_IMPORT_KEYS.indexOf(k));
const n = PARTY_IMPORT_MAX_ROWS.toLocaleString('en-IN');

async function workbook(): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Billing';
  return wb;
}

/** The Parties sheet: headings, widths, text columns and the drop-down lists for 1,000 rows. */
function partiesSheet(wb: Workbook, problems: boolean): Worksheet {
  const ws = wb.addWorksheet(PARTY_IMPORT_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [...PARTY_IMPORT_COLUMNS.map((c) => ({ width: WIDTHS[c.key] })), ...(problems ? [{ width: 70 }] : [])];
  const head = ws.getRow(1);
  [...PARTY_IMPORT_COLUMNS.map((c) => c.title), ...(problems ? [PARTY_IMPORT_PROBLEM_COLUMN] : [])].forEach((t, i) => {
    const c = head.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, size: 11, name: 'Calibri', ...(problems && i === PARTY_IMPORT_COLUMNS.length ? { color: { argb: 'FFDC2626' } } : {}) };
    c.fill = HEAD_FILL;
  });
  // typed as text, so phone numbers and GSTINs are kept exactly
  for (const k of ['name', 'phone', 'gstin', 'address', 'city'] as const) ws.getColumn(PARTY_IMPORT_KEYS.indexOf(k) + 1).numFmt = '@';

  const lists = wb.addWorksheet('Lists', { state: 'veryHidden' });
  lists.getCell(1, 1).value = 'States';
  STATES.forEach(([, name], r) => { lists.getCell(r + 2, 1).value = name; });
  const strict = (k: PartyImportKey, formula: string, msg: string) =>
    validations(ws).add(`${colOf(k)}2:${colOf(k)}${LAST_ROW}`, { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Not in the list', error: msg });
  strict('type', `"${PARTY_TYPES.join(',')}"`, 'Choose Customer or Supplier.');
  strict('balType', `"${BALANCE_TYPES.join(',')}"`, 'Choose To receive or To pay.');
  strict('state', `Lists!$A$2:$A$${STATES.length + 1}`, 'Choose a state from the list.');
  return ws;
}

function instructionsSheet(wb: Workbook) {
  const ws = wb.addWorksheet('Instructions');
  ws.columns = [{ width: 20 }, { width: 100 }];
  const add = (vals: string[], style?: 'title' | 'head') => {
    const r = ws.addRow(vals);
    if (style === 'title') r.getCell(1).font = { bold: true, size: 14, name: 'Calibri' };
    if (style === 'head') r.eachCell((c) => { c.font = { bold: true, size: 11, name: 'Calibri' }; c.fill = HEAD_FILL; });
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    return r;
  };
  add(['Import Parties — how to fill the Parties sheet'], 'title');
  add(['1.', 'Row 2 of the Parties sheet is an example. Replace it with your own parties, one per row (if it is left in, it is skipped).']);
  add(['2.', 'Keep the headings in row 1. Columns may be in any order; only Party name is required.']);
  add(['3.', `At most ${n} parties per file. Save as .xlsx (or .csv) and upload it on Parties › Import Parties › Import from Excel.`]);
  add(['4.', 'Every row is checked and shown before anything is saved. Rows with a mistake are not saved; parties you already have (same name or phone) are skipped.']);
  add([]);
  add(['Column', 'What to enter'], 'head');
  for (const c of PARTY_IMPORT_COLUMNS) add([c.title, c.note]);
}

/** Rows written into a Parties sheet: numbers as numbers (Excel flags numbers stored as text). */
function writeRows(ws: Worksheet, rows: (Partial<Record<PartyImportKey, string>> & { problem?: string })[]) {
  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    PARTY_IMPORT_KEYS.forEach((k, ci) => { const v = r[k]; if (v) row.getCell(ci + 1).value = NUM_KEYS.includes(k) && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v; });
    if (r.problem) { const c = row.getCell(PARTY_IMPORT_KEYS.length + 1); c.value = r.problem; c.font = { color: { argb: 'FFDC2626' } }; c.alignment = { wrapText: true, vertical: 'top' }; }
  });
}

const blob = async (wb: Workbook) => new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE });

export async function sampleBlob(): Promise<Blob> {
  const wb = await workbook();
  writeRows(partiesSheet(wb, false), [PARTY_EXAMPLE_ROW]);
  instructionsSheet(wb);
  return blob(wb);
}

/** The rejected rows as typed, with the reasons in a last "Problem" column (fix them and upload this file again). */
export async function rejectedBlob(rows: (Record<PartyImportKey, string> & { problem: string })[]): Promise<Blob> {
  const wb = await workbook();
  writeRows(partiesSheet(wb, true), rows);
  instructionsSheet(wb);
  return blob(wb);
}

/** A cell as text; numbers lose float noise (a phone typed as a number stays its 10 digits). */
function text(v: CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${String(v.getUTCDate()).padStart(2, '0')}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${v.getUTCFullYear()}`;
  if (typeof v === 'number') return String(Number(v.toPrecision(15)));
  if (typeof v === 'object') {
    if ('result' in v) return text((v as { result?: CellValue }).result ?? null);
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text ?? '');
    if ('error' in v) return '';
  }
  return String(v);
}

export class PartyFileError extends Error {}

/** The sheet's cells as text: the first row is the headings. */
async function cellsOf(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) {
    const t = await file.text();
    const first = t.split(/\r?\n/, 1)[0] ?? '';
    // Excel saves CSV with ';' in some countries' settings
    const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
    return splitPasted(t, sep);
  }
  const wb = await workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new PartyFileError('This file could not be opened as an Excel file. Save it again as .xlsx and try once more.');
  }
  const ws = wb.getWorksheet(PARTY_IMPORT_SHEET) ?? wb.worksheets.find((w) => w.state === 'visible');
  if (!ws) throw new PartyFileError('This file has no sheet with parties. Download the sample file and copy your rows into it.');
  const width = ws.getRow(1).cellCount;
  const out: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    out.push(Array.from({ length: Math.max(width, row.cellCount) }, (_, i) => text(row.getCell(i + 1).value)));
  }
  return out;
}

/** Reads an uploaded .xlsx / .csv. Refuses other files, files that are too big or empty, and files without a Party name column. */
export async function readPartyFile(file: File): Promise<PartyImportRow[]> {
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw new PartyFileError('Choose an Excel file (.xlsx) or a .csv file. Other files cannot be imported.');
  if (file.size > PARTY_IMPORT_MAX_BYTES) throw new PartyFileError(`This file is ${(file.size / 1048576).toFixed(1)} MB. A file can be at most ${PARTY_IMPORT_MAX_BYTES / 1048576} MB.`);
  const cells = await cellsOf(file);
  const heads = (cells[0] ?? []).map((h) => h.trim());
  const keys = heads.map(partyColumnOf);
  if (!keys.includes('name')) {
    const found = heads.filter(Boolean);
    throw new PartyFileError(`The file needs a “Party name” column in row 1.${found.length ? ` Headings found: ${found.slice(0, 8).map((h) => `“${h}”`).join(', ')}.` : ' Row 1 is empty.'} Download the sample file to see the headings.`);
  }
  const rows: PartyImportRow[] = [];
  for (let r = 1; r < cells.length; r++) {
    const row = { line: r + 1, ...Object.fromEntries(PARTY_IMPORT_KEYS.map((k) => [k, ''])) } as PartyImportRow;
    // the first column with a heading wins (e.g. the Problem column of a rejected-rows file is ignored)
    keys.forEach((k, i) => { if (k && !row[k]) row[k] = (cells[r]![i] ?? '').trim(); });
    if (isBlankPartyRow(row)) continue;
    rows.push(row);
    if (rows.length > PARTY_IMPORT_MAX_ROWS) throw new PartyFileError(`This file has more than ${n} parties. Split it into smaller files of up to ${n} rows.`);
  }
  if (!rows.length) throw new PartyFileError('The file has no parties under the headings. Fill in your parties and upload it again.');
  return rows;
}
