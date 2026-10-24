/**
 * Items › Import products: the Excel template (Products sheet with drop-down lists, a Notes sheet
 * with a sample row of each product type, the lists on a hidden sheet), the "error rows" file
 * (the same template + a Problem column) and reading an uploaded file back.
 */
import {
  IMPORT_COLUMNS, IMPORT_KEYS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, IMPORT_PROBLEM_COLUMN, IMPORT_SHEET, IMPORT_TYPES,
  isBlankImportRow, type ImportContext, type ImportKey, type ImportRow,
} from '@billing/shared';
import type { Workbook, Worksheet, CellValue, DataValidation } from 'exceljs';

/** exceljs has drop-down lists for whole ranges (one rule per range), missing from its type file */
const validations = (ws: Worksheet) => (ws as Worksheet & { dataValidations: { add(range: string, v: DataValidation): void } }).dataValidations;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE3F3F0' } };
const WIDTHS: Record<ImportKey, number> = { type: 16, name: 38, brand: 16, series: 20, code: 16, qty: 14, rate: 12, date: 14, unit: 12, sale: 12, min: 12, godown: 18, category: 18, gst: 9, hsn: 12 };
const LAST_ROW = IMPORT_MAX_ROWS + 1;
const NUM_KEYS: ImportKey[] = ['qty', 'rate', 'sale', 'min', 'gst'];
const col = (i: number) => String.fromCharCode(65 + i);
const colOf = (k: ImportKey) => col(IMPORT_KEYS.indexOf(k));

/** One sample row of each product type (on their own Samples sheet, so they are never imported by mistake). */
export const SAMPLE_ROWS: Record<ImportKey, string>[] = [
  { type: 'Single Range', name: 'Indotech 5-30A LCB meter', brand: 'Indotech', series: '', code: 'IT-LCB530', qty: '25', rate: '460', date: '01-04-2026', unit: 'PCS', sale: '550', min: '5', godown: '', category: '', gst: '18', hsn: '9028' },
  // no brand: optional for Single Range
  { type: 'Single Range', name: 'PVC insulation tape 18mm', brand: '', series: '', code: '', qty: '50', rate: '12', date: '01-04-2026', unit: 'PCS', sale: '18', min: '10', godown: '', category: '', gst: '18', hsn: '3919' },
  // no brand code: it is optional
  { type: 'Multi Range', name: 'Modular switch 6A', brand: 'Havells', series: 'Coral', code: '', qty: '100', rate: '42', date: '01-04-2026', unit: 'PCS', sale: '55', min: '20', godown: '', category: '', gst: '18', hsn: '8536' },
];

async function workbook(): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Billing';
  return wb;
}

/** The Products sheet: headers, column widths, text columns, and the drop-down lists for 5,000 rows. */
function productsSheet(wb: Workbook, shop: ImportContext, problems: boolean): Worksheet {
  const ws = wb.addWorksheet(IMPORT_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [...IMPORT_COLUMNS.map((c) => ({ width: WIDTHS[c.key] })), ...(problems ? [{ width: 70 }] : [])];
  const head = ws.getRow(1);
  [...IMPORT_COLUMNS.map((c) => c.title), ...(problems ? [IMPORT_PROBLEM_COLUMN] : [])].forEach((t, i) => {
    const c = head.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, size: 11, name: 'Calibri', ...(problems && i === IMPORT_COLUMNS.length ? { color: { argb: 'FFDC2626' } } : {}) };
    c.fill = HEAD_FILL;
  });
  // typed as text, so codes like 0012 keep their zeros
  for (const k of ['name', 'brand', 'series', 'code', 'hsn'] as const) ws.getColumn(IMPORT_KEYS.indexOf(k) + 1).numFmt = '@';
  ws.getColumn(IMPORT_KEYS.indexOf('date') + 1).numFmt = 'dd-mm-yyyy';

  // the lists, on a hidden sheet
  const lists = wb.addWorksheet('Lists', { state: 'veryHidden' });
  const units = shop.units.map((u) => u.code);
  const godowns = shop.godowns.map((g) => g.name);
  const gst = shop.gstRates;
  const cols: [string, string[]][] = [['Units', units], ['Godowns', godowns], ['Categories', shop.categories], ['GST %', gst]];
  cols.forEach(([t, vals], i) => { lists.getCell(1, i + 1).value = t; vals.forEach((v, r) => { lists.getCell(r + 2, i + 1).value = v; }); });
  const range = (i: number, n: number) => `Lists!$${col(i)}$2:$${col(i)}$${Math.max(2, n + 1)}`;
  const strict = (k: ImportKey, formula: string, msg: string) =>
    validations(ws).add(`${colOf(k)}2:${colOf(k)}${LAST_ROW}`, { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Not in the list', error: msg });
  strict('type', `"${IMPORT_TYPES.join(',')}"`, 'Choose Single Range or Multi Range.');
  if (units.length) strict('unit', range(0, units.length), 'Choose a unit from the list.');
  if (godowns.length) strict('godown', range(1, godowns.length), 'Choose a godown from the list, or leave it blank for the main godown.');
  // a new category is allowed: the list only helps
  if (shop.categories.length) validations(ws).add(`${colOf('category')}2:${colOf('category')}${LAST_ROW}`, { type: 'list', allowBlank: true, formulae: [range(2, shop.categories.length)], showErrorMessage: false });
  if (gst.length) strict('gst', range(3, gst.length), 'Choose a GST rate from your tax list.');
  return ws;
}

function notesSheet(wb: Workbook) {
  const ws = wb.addWorksheet('Notes');
  ws.columns = [{ width: 22 }, { width: 26 }, { width: 90 }];
  const add = (vals: string[], style?: 'title' | 'head' | 'section') => {
    const r = ws.addRow(vals);
    if (style === 'title') r.getCell(1).font = { bold: true, size: 14, name: 'Calibri' };
    if (style === 'head') r.eachCell((c) => { c.font = { bold: true, size: 11, name: 'Calibri' }; c.fill = HEAD_FILL; });
    if (style === 'section') r.getCell(1).font = { bold: true, size: 11, name: 'Calibri' };
    return r;
  };
  add(['Import products — how to fill the Products sheet'], 'title');
  add(['Fill one product per row on the Products sheet. Do not change, move or rename the column headings.']);
  add([`At most ${IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows per file. Save as .xlsx and upload it on Items › Import products.`]);
  add(['Nothing is saved until you press Final import. You can correct every row on the checking screen first.']);
  add([]);
  add(['Column', 'Required for', 'What to enter'], 'head');
  const req: Partial<Record<ImportKey, string>> = { type: 'Both', name: 'Both', brand: 'Multi Range', series: 'Multi Range' };
  for (const c of IMPORT_COLUMNS) add([c.title, req[c.key] ?? '—', c.note]);
  add([]);
  add(['Single Range', 'One item. Its product name must be new. Brand is optional (leave it blank for no brand); a series needs a brand.'], 'section');
  add(['Multi Range', 'Brand and series are required. Many brands and series under one product name, e.g. Modular switch 6A → Havells Coral, Anchor Roma. Saved like Add item’s Variant: “Modular switch 6A · Havells Coral”.'], 'section');
  add([]);
  add(['Samples', 'The Samples sheet has filled-in rows of each product type (one Single Range row has no brand, and the Multi Range one has no brand code: both are optional). Copy the layout, not the rows.'], 'section');
}

/** One sample row of each product type, laid out like the Products sheet (never read on upload). */
function samplesSheet(wb: Workbook) {
  const ws = wb.addWorksheet('Samples', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ width: WIDTHS[c.key] }));
  const hr = ws.addRow(IMPORT_COLUMNS.map((c) => c.title));
  hr.eachCell((c) => { c.font = { bold: true, size: 11, name: 'Calibri' }; c.fill = HEAD_FILL; });
  for (const s of SAMPLE_ROWS) ws.addRow(IMPORT_KEYS.map((k) => (NUM_KEYS.includes(k) && s[k] ? Number(s[k]) : s[k])));
}

/** Rows written back into a Products sheet (the error-rows file). */
function writeRows(ws: Worksheet, rows: (Record<ImportKey, string> & { problem?: string })[]) {
  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    // numbers go back as numbers (Excel would flag numbers stored as text)
    IMPORT_KEYS.forEach((k, ci) => { if (r[k]) row.getCell(ci + 1).value = NUM_KEYS.includes(k) && /^-?\d+(\.\d+)?$/.test(r[k]) ? Number(r[k]) : r[k]; });
    if (r.problem) { const c = row.getCell(IMPORT_KEYS.length + 1); c.value = r.problem; c.font = { color: { argb: 'FFDC2626' } }; c.alignment = { wrapText: true, vertical: 'top' }; }
  });
}

const blob = async (wb: Workbook) => new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE });

export async function templateBlob(shop: ImportContext): Promise<Blob> {
  const wb = await workbook();
  productsSheet(wb, shop, false);
  notesSheet(wb);
  samplesSheet(wb);
  return blob(wb);
}

/** The rows that still have errors, in the template, with the reasons in a last "Problem" column. */
export async function errorRowsBlob(shop: ImportContext, rows: (Record<ImportKey, string> & { problem: string })[]): Promise<Blob> {
  const wb = await workbook();
  writeRows(productsSheet(wb, shop, true), rows);
  notesSheet(wb);
  samplesSheet(wb);
  return blob(wb);
}

/** A cell as text. Dates become dd-mm-yyyy (Excel keeps them as UTC midnight); numbers lose float noise. */
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

const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/\*$/, '').trim().toLowerCase();

export class ImportFileError extends Error {}

/** Reads an uploaded template. Refuses anything that is not the template, too big, or empty. */
export async function readImportFile(file: File): Promise<ImportRow[]> {
  if (!/\.xlsx$/i.test(file.name)) throw new ImportFileError('Choose an Excel file (.xlsx) made from the template. Other files cannot be imported.');
  if (file.size > IMPORT_MAX_BYTES) throw new ImportFileError(`This file is ${(file.size / 1048576).toFixed(1)} MB. A file can be at most ${IMPORT_MAX_BYTES / 1048576} MB.`);
  const wb = await workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new ImportFileError('This file could not be opened as an Excel file. Save it again as .xlsx and try once more.');
  }
  const ws = wb.getWorksheet(IMPORT_SHEET) ?? wb.worksheets.find((w) => w.state === 'visible');
  if (!ws) throw new ImportFileError('This file has no Products sheet. Download the template and copy your rows into it.');
  const head = IMPORT_COLUMNS.map((_, i) => norm(text(ws.getRow(1).getCell(i + 1).value)));
  const extra = norm(text(ws.getRow(1).getCell(IMPORT_COLUMNS.length + 1).value));
  const bad = IMPORT_COLUMNS.findIndex((c, i) => head[i] !== norm(c.title));
  if (bad >= 0 || (extra && extra !== norm(IMPORT_PROBLEM_COLUMN)))
    throw new ImportFileError(bad >= 0
      ? `This is not the import template: column ${col(bad)} should be “${IMPORT_COLUMNS[bad]!.title}”${head[bad] ? `, not “${text(ws.getRow(1).getCell(bad + 1).value)}”` : ''}. Download the template and copy your rows into it.`
      : 'This is not the import template: it has extra columns. Download the template and copy your rows into it.');

  const rows: ImportRow[] = [];
  for (let n = 2; n <= ws.rowCount; n++) {
    const r = ws.getRow(n);
    const row = { line: n } as ImportRow;
    IMPORT_KEYS.forEach((k, i) => { row[k] = text(r.getCell(i + 1).value).trim(); });
    if (isBlankImportRow(row)) continue;
    rows.push(row);
    if (rows.length > IMPORT_MAX_ROWS) throw new ImportFileError(`This file has more than ${IMPORT_MAX_ROWS.toLocaleString('en-IN')} products. Split it into smaller files of up to ${IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows.`);
  }
  if (!rows.length) throw new ImportFileError('The Products sheet has no rows. Fill in your products under the headings and upload it again.');
  return rows;
}
