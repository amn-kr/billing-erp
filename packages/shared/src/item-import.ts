/**
 * Import products from Excel (Items › Import products). The template's columns, and the
 * checks every row goes through — run in the browser as rows are edited, and again on the
 * server inside the import's transaction, so both always agree.
 *
 * Single Range = an item like Add item's "Single" (brand required here).
 * Multi Range  = Add item's "Variant": the product name is the parent item, and the item is
 *                saved as "Product · Brand Series".
 */
import { z } from 'zod';
import { D, MONEY_MAX, type Money } from './money.js';
import { parseIso } from './dates.js';

export const IMPORT_COLUMNS = [
  { key: 'type', title: 'Product type', note: 'Single Range or Multi Range (pick from the list). Required.' },
  { key: 'name', title: 'Product name', note: 'Required. Single Range: the item name, must be new. Multi Range: the parent item; it can repeat for many brands and series.' },
  { key: 'brand', title: 'Brand name', note: 'Required. A brand that is not in Brands & Series yet is created on import.' },
  { key: 'series', title: 'Series / range name', note: 'Required for Multi Range, e.g. Coral. Product + brand + series must be new. Not used for Single Range.' },
  { key: 'code', title: 'Brand code', note: "Required. The brand's item code. Must not be used by another item." },
  { key: 'qty', title: 'Opening stock', note: 'Quantity in stock today. Optional. Not negative.' },
  { key: 'rate', title: 'At price', note: 'Rate of the opening stock per unit. Required when there is opening stock (0 is allowed). Also saved as the purchase price.' },
  { key: 'date', title: 'As of date', note: 'Date of the opening stock, e.g. 01-04-2026. Blank = today. Not in the future.' },
  { key: 'unit', title: 'Base unit', note: 'Pick from the list (your units). Blank = PCS.' },
  { key: 'sale', title: 'Sale price', note: 'Optional. Blank = 0.' },
  { key: 'min', title: 'Stock alert', note: 'Low-stock quantity. Optional.' },
  { key: 'godown', title: 'Location', note: 'The godown for the opening stock (pick from the list). Blank = your main godown.' },
  { key: 'category', title: 'Category', note: 'Optional. A category that does not exist yet is created on import.' },
  { key: 'gst', title: 'GST %', note: 'A rate from your tax list, e.g. 18. Blank = 18.' },
  { key: 'hsn', title: 'HSN', note: 'Optional. 4 to 8 digits.' },
] as const;

export type ImportKey = (typeof IMPORT_COLUMNS)[number]['key'];
export const IMPORT_KEYS = IMPORT_COLUMNS.map((c) => c.key) as ImportKey[];
/** One row as typed: every cell is text. `line` is the row number in the Excel file. */
export type ImportRow = { line: number } & Record<ImportKey, string>;

export const IMPORT_TYPES = ['Single Range', 'Multi Range'] as const;
export const IMPORT_SHEET = 'Products';
/** extra last column in the "error rows" file; ignored when the file comes back */
export const IMPORT_PROBLEM_COLUMN = 'Problem';
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_DEFAULT_GST = '18';

/** What the shop already has, to check rows against. Names as saved (any capital letters). */
export interface ImportContext {
  /** today in India, ISO */
  today: string;
  /** live items; group / brand are names ('' when none) */
  items: { name: string; code: string; group: string; brand: string; series: string }[];
  brands: { name: string; active: boolean }[];
  /** series saved on Brands & Series (active or not) */
  series: { brand: string; name: string; active: boolean }[];
  groups: string[];
  units: { code: string; name: string }[];
  godowns: { name: string; isDefault: boolean }[];
  categories: string[];
  /** the shop's GST rates, e.g. "18" or "0.25" */
  gstRates: string[];
}

export type IssueLevel = 'error' | 'warning';
export interface CellIssue { level: IssueLevel; message: string }
export type RowStatus = 'ok' | 'warning' | 'error';

/** A checked row, ready to save (values are cleaned; names use the shop's existing spelling). */
export interface ImportItem {
  line: number;
  kind: 'single' | 'multi';
  /** the item's name: Single = product name; Multi = "Product · Brand Series" */
  name: string;
  group: string;
  brand: string;
  series: string;
  code: string;
  /** opening stock, 3 decimals; null = none */
  qty: string | null;
  rate: string | null;
  date: string | null;
  unit: string;
  sale: string;
  minStock: string;
  /** godown name; '' = the main godown */
  godown: string;
  category: string;
  gst: string;
  hsn: string;
  newBrand: boolean;
  newSeries: boolean;
  newGroup: boolean;
  newCategory: boolean;
}

export interface RowCheck {
  line: number;
  status: RowStatus;
  /** problems by column; 'row' for the row as a whole */
  cells: Partial<Record<ImportKey | 'row', CellIssue[]>>;
  item: ImportItem | null;
}

/** "Parent · Brand Series" — the name Add item gives a variant (AddItemDialog vname). */
export const variantName = (group: string, brand: string, series: string) => `${group} · ${brand}${series ? ' ' + series : ''}`;

const low = (s: string) => s.trim().toLowerCase();
const QTY_MAX = new D('99999999999.999');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A typed number: "1,250" / "₹ 99.5" → Decimal; blank → null; anything else → 'bad'. */
export function parseImportNumber(v: string): Money | null | 'bad' {
  const s = v.replace(/[,₹\s]/g, '').replace(/^rs\.?/i, '');
  if (!s) return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return 'bad';
  return new D(s);
}

const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const real = (s: string) => { try { parseIso(s); return s; } catch { return null; } };

/**
 * A typed date → ISO, or null when it is not a real date. Takes 15-04-2026, 15/04/2026, 15.04.2026,
 * 15-Apr-2026, 2026-04-15 and Excel's day numbers (46127 = 15 Apr 2026). Day first, as in India.
 */
export function parseImportDate(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return real(iso(+m[1]!, +m[2]!, +m[3]!));
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/.exec(s);
  if (m) return real(iso(+m[3]!, +m[2]!, +m[1]!));
  m = /^(\d{1,2})[-/. ]([a-z]{3})[a-z]*[-/. ,]+(\d{4})$/i.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[2]!.toLowerCase()); return mo < 0 ? null : real(iso(+m[3]!, mo + 1, +m[1]!)); }
  if (/^\d{5}$/.test(s)) {
    // Excel day number: day 25569 = 1 Jan 1970
    const d = new Date((+s - 25569) * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/** Shows a date as the shop reads it: 15-04-2026. */
export const showDate = (isoDate: string) => isoDate.split('-').reverse().join('-');

export const isBlankImportRow = (r: Record<ImportKey, string>) => IMPORT_KEYS.every((k) => !(r[k] ?? '').trim());

/** Checks every row against the shop and against the other rows of the file. */
export function checkImportRows(rows: ImportRow[], ctx: ImportContext): RowCheck[] {
  // what the shop already has, by lower-case name
  const itemNames = new Map(ctx.items.map((i) => [low(i.name), i.name]));
  const itemCodes = new Map(ctx.items.filter((i) => i.code.trim()).map((i) => [low(i.code), i.name]));
  const variants = new Map(ctx.items.filter((i) => i.group && i.brand).map((i) => [`${low(i.group)}|${low(i.brand)}|${low(i.series)}`, i.name]));
  const brands = new Map(ctx.brands.map((b) => [low(b.name), b]));
  const series = new Map<string, { name: string; active: boolean }>();
  // series typed on items count as existing, like on Brands & Series
  for (const i of ctx.items) if (i.brand && i.series.trim()) series.set(`${low(i.brand)}|${low(i.series)}`, { name: i.series.trim(), active: true });
  for (const s of ctx.series) series.set(`${low(s.brand)}|${low(s.name)}`, { name: s.name, active: s.active });
  const groups = new Map(ctx.groups.map((g) => [low(g), g]));
  const units = new Map<string, string>();
  for (const u of ctx.units) { if (u.name.trim()) units.set(low(u.name), u.code); }
  for (const u of ctx.units) units.set(low(u.code), u.code);
  const godowns = new Map(ctx.godowns.map((g) => [low(g.name), g.name]));
  const categories = new Map(ctx.categories.map((c) => [low(c), c]));
  const gstRates = ctx.gstRates.map((r) => new D(r));

  // first pass: each row on its own
  const out = rows.map((r) => checkOne(r));

  // a new name typed with other capital letters on a later row uses the first row's spelling
  const first = new Map<string, string>();
  const same = (kind: string, v: string) => { const k = `${kind}|${low(v)}`; if (!first.has(k)) first.set(k, v); return first.get(k)!; };
  for (const c of out) {
    const i = c.item;
    if (!i) continue;
    if (i.newBrand) i.brand = same('b', i.brand);
    if (i.newGroup) i.group = same('g', i.group);
    if (i.newSeries) i.series = same(`s|${low(i.brand)}`, i.series);
    if (i.newCategory) i.category = same('c', i.category);
    if (i.kind === 'multi') i.name = variantName(i.group, i.brand, i.series);
  }

  // second pass: the same thing twice in the file (both rows are marked)
  const repeats = (key: (c: RowCheck) => string | null, col: ImportKey, what: string) => {
    const seen = new Map<string, number[]>();
    for (const c of out) { const k = key(c); if (k) seen.set(k, [...(seen.get(k) ?? []), c.line]); }
    for (const c of out) {
      const k = key(c);
      const lines = k ? seen.get(k)! : [];
      if (lines.length < 2) continue;
      const others = lines.filter((l) => l !== c.line);
      add(c, col, 'error', `${what} is also in row ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''} of the uploaded file.`);
    }
  };
  repeats((c) => (c.item?.kind === 'single' ? low(c.item.name) : null), 'name', 'This product name');
  repeats((c) => (c.item?.kind === 'multi' ? `${low(c.item.group)}|${low(c.item.brand)}|${low(c.item.series)}` : null), 'series', 'This product, brand and series');
  // a Single Range name that is also the full name of a Multi Range item in the file
  const multiNames = new Map(out.filter((c) => c.item?.kind === 'multi').map((c) => [low(c.item!.name), c.line]));
  for (const c of out) {
    const hit = c.item?.kind === 'single' ? multiNames.get(low(c.item.name)) : undefined;
    if (hit) add(c, 'name', 'error', `Row ${hit} makes an item with this same name.`);
  }
  repeats((c) => (c.item?.code ? low(c.item.code) : null), 'code', 'This brand code');

  for (const c of out) {
    c.status = Object.values(c.cells).some((l) => l?.some((i) => i.level === 'error')) ? 'error' : Object.values(c.cells).some((l) => l?.length) ? 'warning' : 'ok';
    if (c.status === 'error') c.item = null;
  }
  return out;

  function checkOne(r: ImportRow): RowCheck {
    const c: RowCheck = { line: r.line, status: 'ok', cells: {}, item: null };
    const v = (k: ImportKey) => (r[k] ?? '').trim();
    const err = (k: ImportKey, m: string) => add(c, k, 'error', m);
    const warn = (k: ImportKey, m: string) => add(c, k, 'warning', m);
    const long = (k: ImportKey, max: number, what: string) => { if (v(k).length > max) err(k, `${what} is too long (at most ${max} letters).`); };

    const t = low(v('type')).replace(/\s+/g, ' ');
    const kind = t === 'single range' || t === 'single' ? 'single' : t === 'multi range' || t === 'multi' ? 'multi' : null;
    if (!v('type')) err('type', 'Choose Single Range or Multi Range.');
    else if (!kind) err('type', `“${v('type')}” is not a product type. Choose Single Range or Multi Range.`);

    // required columns
    if (!v('name')) err('name', 'Enter the product name.');
    if (!v('brand')) err('brand', 'Enter the brand name.');
    if (kind === 'multi' && !v('series')) err('series', 'Enter the series / range name (needed for Multi Range).');
    if (!v('code')) err('code', 'Enter the brand code.');
    if (kind === 'single' && v('series')) warn('series', 'Series is only used for Multi Range. It will be ignored.');
    long('name', kind === 'multi' ? 160 : 200, 'The product name');
    long('brand', 80, 'The brand name');
    long('series', 80, 'The series name');
    long('code', 60, 'The brand code');
    long('category', 80, 'The category name');

    // brand and series: existing spelling, or "will be created"
    const b = brands.get(low(v('brand')));
    const brand = b?.name ?? v('brand');
    if (v('brand') && !b) warn('brand', `New brand “${brand}” will be created.`);
    else if (b && !b.active) warn('brand', `Brand “${brand}” is inactive on Brands & Series. The item will still be added.`);
    let ser = kind === 'multi' ? v('series') : '';
    let newSeries = false;
    if (kind === 'multi' && ser && v('brand')) {
      const s = series.get(`${low(brand)}|${low(ser)}`);
      if (!s) { newSeries = true; warn('series', `New series “${ser}” for ${brand} will be created.`); }
      else { ser = s.name; if (!s.active) warn('series', `Series “${ser}” is inactive on Brands & Series. The item will still be added.`); }
    }

    // the item's own name, and duplicates against the shop
    const g = kind === 'multi' ? groups.get(low(v('name'))) : undefined;
    const group = kind === 'multi' ? (g ?? v('name')) : '';
    if (kind === 'multi' && v('name') && !g) warn('name', `New parent item “${group}” will be created.`);
    const name = kind === 'multi' ? variantName(group, brand, ser) : v('name');
    if (kind === 'single' && v('name') && itemNames.has(low(name))) err('name', `An item called “${itemNames.get(low(name))}” already exists.`);
    if (kind === 'multi' && v('name') && v('brand') && ser) {
      const hit = variants.get(`${low(group)}|${low(brand)}|${low(ser)}`) ?? itemNames.get(low(name));
      if (hit) err('series', `${brand} ${ser} is already in ${group} (item “${hit}”).`);
      else if (name.length > 200) err('series', 'The full item name (product · brand series) is too long.');
    }
    const used = v('code') ? itemCodes.get(low(v('code'))) : undefined;
    if (used) err('code', `Brand code ${v('code')} is already used by “${used}”.`);

    // numbers
    const amount = (k: ImportKey, what: string, places: number, max: Money) => {
      const n = parseImportNumber(v(k));
      if (n === null) return null;
      if (n === 'bad') { err(k, `${what} must be a number.`); return undefined; }
      if (n.isNegative() && !n.isZero()) { err(k, `${what} cannot be negative.`); return undefined; }
      if (n.gt(max)) { err(k, `${what} is too large.`); return undefined; }
      if (n.decimalPlaces() > places) warn(k, `${what} will be rounded to ${n.toDecimalPlaces(places, D.ROUND_HALF_UP).toFixed(places)}.`);
      return n.toDecimalPlaces(places, D.ROUND_HALF_UP);
    };
    const qty = amount('qty', 'Opening stock', 3, QTY_MAX);
    const rate = amount('rate', 'At price', 2, MONEY_MAX);
    const sale = amount('sale', 'Sale price', 2, MONEY_MAX);
    const min = amount('min', 'Stock alert', 3, QTY_MAX);
    const hasStock = !!qty && qty.gt(0);

    // date
    let date: string | null = null;
    if (v('date')) {
      date = parseImportDate(v('date'));
      if (!date) err('date', `“${v('date')}” is not a date. Type it like 01-04-2026.`);
      else if (date > ctx.today) err('date', `The date ${showDate(date)} is in the future.`);
      else if (date < '2000-01-01') err('date', `The date ${showDate(date)} looks wrong.`);
    }
    if (hasStock) {
      if (v('rate') === '') err('rate', 'Enter the rate of the opening stock (0 if it cost nothing).');
      else if (rate && rate.isZero()) warn('rate', 'At price is 0, so this stock will have no value.');
      if (!v('date')) warn('date', `No date: today (${showDate(ctx.today)}) will be used.`);
    } else if (qty !== undefined && v('date') && date) warn('date', 'There is no opening stock, so this date will be ignored.');
    if (!v('sale')) warn('sale', 'No sale price: it will be saved as 0.');
    else if (sale && rate && sale.lt(rate)) warn('sale', `Sale price is lower than the At price (${rate.toFixed(2)}).`);

    // lists
    let unit = 'PCS';
    if (v('unit')) {
      const u = units.get(low(v('unit')));
      if (u) unit = u; else err('unit', `Unit “${v('unit')}” is not in your units. Choose one from the list.`);
    }
    let godown = '';
    if (v('godown')) {
      const gd = godowns.get(low(v('godown')));
      if (gd) godown = gd; else err('godown', `There is no godown called “${v('godown')}”. Choose one from the list.`);
    }
    const cat = categories.get(low(v('category')));
    const category = cat ?? v('category');
    if (v('category') && !cat) warn('category', `New category “${category}” will be created.`);
    let gst = IMPORT_DEFAULT_GST;
    if (!v('gst')) warn('gst', `No GST rate: ${IMPORT_DEFAULT_GST}% will be used.`);
    else {
      const n = parseImportNumber(v('gst').replace(/%$/, ''));
      const hit = n && n !== 'bad' ? gstRates.find((x) => x.eq(n)) : undefined;
      if (hit) gst = hit.toString();
      else err('gst', `${v('gst')}${/%$/.test(v('gst')) ? '' : '%'} is not a GST rate in your tax list.`);
    }
    const hsn = v('hsn').replace(/\s/g, '');
    if (hsn && !/^\d{4,8}$/.test(hsn)) err('hsn', 'HSN is 4 to 8 digits.');

    if (kind) c.item = {
      line: r.line, kind, name, group, brand, series: ser, code: v('code'),
      qty: hasStock ? qty!.toFixed(3) : null, rate: rate ? rate.toFixed(2) : null, date: hasStock ? (date ?? ctx.today) : null,
      unit, sale: (sale ?? new D(0)).toFixed(2), minStock: (min ?? new D(0)).toFixed(3), godown, category, gst, hsn,
      newBrand: !!v('brand') && !b, newSeries, newGroup: kind === 'multi' && !!v('name') && !g, newCategory: !!v('category') && !cat,
    };
    return c;
  }
}

function add(c: RowCheck, k: ImportKey | 'row', level: IssueLevel, message: string) {
  (c.cells[k] ??= []).push({ level, message });
}

/** Plain-words reasons for a row, for the summary and the error-rows file. */
export function rowProblems(c: RowCheck, level?: IssueLevel): string[] {
  const title = new Map<string, string>(IMPORT_COLUMNS.map((x) => [x.key, x.title]));
  return Object.entries(c.cells).flatMap(([k, list]) => (list ?? []).filter((i) => !level || i.level === level).map((i) => (k === 'row' ? i.message : `${title.get(k)}: ${i.message}`)));
}

const cell = z.string().max(500).optional().default('');
const rowSchema = z.object({
  line: z.number().int().min(1),
  type: cell, name: cell, brand: cell, series: cell, code: cell, qty: cell, rate: cell, date: cell,
  unit: cell, sale: cell, min: cell, godown: cell, category: cell, gst: cell, hsn: cell,
}) satisfies z.ZodType<ImportRow, z.ZodTypeDef, unknown>;
export const importRowsSchema = z.object({
  rows: z
    .array(rowSchema)
    .min(1, 'There are no rows to import.')
    .max(IMPORT_MAX_ROWS, `A file can have at most ${IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows.`),
  /** import the rows that pass and leave out the rows with errors */
  skipErrors: z.boolean().optional().default(false),
});
export type ImportRowsInput = z.infer<typeof importRowsSchema>;

export interface ImportSummary {
  created: number;
  withStock: number;
  skipped: { line: number; reasons: string[] }[];
  newBrands: string[];
  newSeries: string[];
  newGroups: string[];
  newCategories: string[];
}
