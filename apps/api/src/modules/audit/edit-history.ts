/**
 * The lines of the "Edit History" window, worked out from audit-log update entries. Nothing here
 * changes what is stored: every edit keeps its entry exactly as it was written.
 *
 * Two ways edits were logged:
 * - Group 3 (expenses, cash / bank entries, stock adjustments, transfers): `after.changes` holds
 *   each changed field as { field, old, new }, with ids for accounts, items and godowns.
 * - Everything else (sales side, purchases, payments): only the whole record `before` and `after`.
 *   The changed fields are found here by comparing the two.
 * An entry with neither gives no lines (the window says the details were not saved).
 */
import { formatDmy, formatInr2, formatQty, money, stateName } from '@billing/shared';

/** What an id stands for; turned into a name when the window is built. */
export type RefKind = 'party' | 'item' | 'godown' | 'account' | 'referrer' | 'sale' | 'purchase';
export type Names = Record<RefKind, Map<string, string>>;
export const UNKNOWN = '(deleted or unknown)';

type Fmt = 'text' | 'money' | 'qty' | 'signedQty' | 'pct' | 'date' | 'bool' | 'state' | 'list' | { ref: RefKind } | { words: Record<string, string> }
  /** a whole line added or removed: its values, e.g. "quantity 2, rate ₹95.00" */
  | 'parts'
  /** too big to list (a brand-wise quotation's grid): only that it changed */
  | 'changedOnly';
type Part = { label: string; fmt: Fmt; v: unknown };
type Raw = Record<string, unknown>;

/** One difference: `label` is the field's name on screen; a missing old value means it was added, a missing new one that it was removed. */
export interface Diff { label: string; fmt: Fmt; old: unknown; new: unknown }

interface Field { key: string; label: string; fmt?: Fmt }

const MODE = { words: { credit: 'Credit', cash: 'Cash' } };
const BANK_KIND = { words: { in: 'Money in', out: 'Money out', transfer: 'Bank to bank', deposit: 'Cash deposited in bank', withdraw: 'Cash withdrawn from bank' } };
const CN_SETTLE = { words: { adjust: 'Adjusted against the invoice', refund: 'Refunded' } };

const SALE_HEAD: Field[] = [
  { key: 'date', label: 'Date', fmt: 'date' }, { key: 'mode', label: 'Cash / credit', fmt: MODE }, { key: 'partyId', label: 'Party', fmt: { ref: 'party' } },
  { key: 'cashName', label: 'Customer name' }, { key: 'cashPhone', label: 'Customer phone' }, { key: 'billName', label: 'Billing name' },
  { key: 'placeOfSupply', label: 'Place of supply', fmt: 'state' }, { key: 'pricesInclTax', label: 'Prices include GST', fmt: 'bool' }, { key: 'roundOff', label: 'Round off', fmt: 'bool' },
  { key: 'billDiscPct', label: 'Bill discount', fmt: 'pct' }, { key: 'billDiscAmt', label: 'Bill discount amount', fmt: 'money' },
  { key: 'transport', label: 'Transport charges', fmt: 'money' }, { key: 'labour', label: 'Labour charges', fmt: 'money' }, { key: 'bankCharge', label: 'Bank charges', fmt: 'money' },
  { key: 'total', label: 'Total', fmt: 'money' }, { key: 'notes', label: 'Notes' }, { key: 'referrerId', label: 'Referred by', fmt: { ref: 'referrer' } },
];
const SALE_EXTRA: Field[] = [
  { key: 'challanNo', label: 'Challan no.' }, { key: 'poNo', label: 'PO no.' }, { key: 'poDate', label: 'PO date', fmt: 'date' }, { key: 'ewb', label: 'E-way bill no.' },
  { key: 'transport', label: 'Transporter' }, { key: 'vehicle', label: 'Vehicle no.' }, { key: 'deliveryDate', label: 'Delivery date', fmt: 'date' },
  { key: 'description', label: 'Description' }, { key: 'attachments', label: 'Attachments', fmt: 'list' },
];
const CHALLAN_HEAD: Field[] = [
  { key: 'date', label: 'Date', fmt: 'date' }, { key: 'partyId', label: 'Party', fmt: { ref: 'party' } }, { key: 'cashName', label: 'Customer name' },
  { key: 'cashPhone', label: 'Customer phone' }, { key: 'notes', label: 'Note' },
];
const CN_HEAD: Field[] = [
  { key: 'date', label: 'Date', fmt: 'date' }, { key: 'partyId', label: 'Party', fmt: { ref: 'party' } }, { key: 'cashName', label: 'Customer name' },
  { key: 'status', label: 'Settled', fmt: CN_SETTLE }, { key: 'total', label: 'Total', fmt: 'money' }, { key: 'reason', label: 'Reason' },
];
const BRAND_QUOTE_HEAD: Field[] = [
  { key: 'date', label: 'Date', fmt: 'date' }, { key: 'partyId', label: 'Party', fmt: { ref: 'party' } }, { key: 'cashName', label: 'Customer name' },
  { key: 'total', label: 'Total', fmt: 'money' }, { key: 'referrerId', label: 'Referred by', fmt: { ref: 'referrer' } },
];
const PURCHASE_HEAD: Field[] = [
  { key: 'supplierRef', label: 'Supplier bill no.' }, { key: 'date', label: 'Date', fmt: 'date' }, { key: 'dueDate', label: 'Due date', fmt: 'date' },
  { key: 'partyId', label: 'Supplier', fmt: { ref: 'party' } }, { key: 'pricesInclTax', label: 'Prices include GST', fmt: 'bool' }, { key: 'roundOff', label: 'Round off', fmt: 'bool' },
  { key: 'billDiscPct', label: 'Bill discount', fmt: 'pct' }, { key: 'billDiscAmt', label: 'Bill discount amount', fmt: 'money' },
  { key: 'transport', label: 'Transport charges', fmt: 'money' }, { key: 'labour', label: 'Labour charges', fmt: 'money' },
  { key: 'total', label: 'Total', fmt: 'money' }, { key: 'notes', label: 'Notes' }, { key: 'reason', label: 'Reason' },
];
const PAYMENT_HEAD: Field[] = [
  { key: 'date', label: 'Date', fmt: 'date' }, { key: 'partyId', label: 'Party', fmt: { ref: 'party' } }, { key: 'amount', label: 'Amount', fmt: 'money' },
  { key: 'mode', label: 'Mode' }, { key: 'reference', label: 'Reference' }, { key: 'notes', label: 'Notes' },
];

/** Group 3: the fields their `after.changes` can hold. */
const CHANGE_FIELDS: Record<string, Record<string, Omit<Field, 'key'>>> = {
  expense: {
    date: { label: 'Date', fmt: 'date' }, category: { label: 'Category' }, payee: { label: 'Paid to' }, mode: { label: 'Paid by' },
    accountId: { label: 'Paid from', fmt: { ref: 'account' } }, reference: { label: 'Reference' }, notes: { label: 'Notes' },
    total: { label: 'Total', fmt: 'money' }, tax: { label: 'GST', fmt: 'money' },
  },
  bank_entry: {
    date: { label: 'Date', fmt: 'date' }, kind: { label: 'Type', fmt: BANK_KIND }, accountId: { label: 'Account', fmt: { ref: 'account' } },
    toAccountId: { label: 'To account', fmt: { ref: 'account' } }, amount: { label: 'Amount', fmt: 'money' }, category: { label: 'Category' },
    reference: { label: 'Reference' }, note: { label: 'Note' },
  },
  stock_adjustment: {
    date: { label: 'Date', fmt: 'date' }, itemId: { label: 'Item', fmt: { ref: 'item' } }, godownId: { label: 'Godown', fmt: { ref: 'godown' } },
    qty: { label: 'Quantity', fmt: 'signedQty' }, rate: { label: 'Rate', fmt: 'money' }, reason: { label: 'Reason' },
  },
  stock_transfer: {
    date: { label: 'Date', fmt: 'date' }, itemId: { label: 'Item', fmt: { ref: 'item' } }, fromGodownId: { label: 'From godown', fmt: { ref: 'godown' } },
    toGodownId: { label: 'To godown', fmt: { ref: 'godown' } }, qty: { label: 'Quantity', fmt: 'qty' }, note: { label: 'Note' },
  },
};

const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!obj(x)) : []);
const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const num = (f: Fmt) => f === 'money' || f === 'qty' || f === 'signedQty' || f === 'pct';

/** Same value for the window: numbers by value ("10" = "10.000"), dates by day, the rest as written. */
function same(f: Fmt, a: unknown, b: unknown): boolean {
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  if (num(f)) { try { return money(String(a)).eq(money(String(b))); } catch { return String(a) === String(b); } }
  if (f === 'date') return String(a).slice(0, 10) === String(b).slice(0, 10);
  return JSON.stringify(a) === JSON.stringify(b);
}

function fieldDiffs(fields: Field[], before: Raw, after: Raw): Diff[] {
  return fields.flatMap((f) => {
    const fmt = f.fmt ?? 'text';
    return same(fmt, before[f.key], after[f.key]) ? [] : [{ label: f.label, fmt, old: before[f.key], new: after[f.key] }];
  });
}

/**
 * Item lines of a document, paired old with new by item (the k-th line of an item with its k-th
 * line, in line order), so "Item Ceiling fan: quantity changed from 6 to 8".
 */
function lineDiffs(before: Raw, after: Raw, rateKey: 'price' | 'rate' | null, extra: { key: string; label: string; fmt: Fmt }[] = []): Diff[] {
  const sorted = (r: Raw) => arr(r.lines).slice().sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  const keyOf = (l: Raw) => String(l.itemId ?? l.name ?? '');
  const group = (L: Raw[]) => {
    const m = new Map<string, Raw[]>();
    for (const l of L) m.set(keyOf(l), [...(m.get(keyOf(l)) ?? []), l]);
    return m;
  };
  const o = group(sorted(before)), n = group(sorted(after));
  const cols: { key: string; label: string; fmt: Fmt }[] = [{ key: 'qty', label: 'quantity', fmt: 'qty' }, ...(rateKey ? [{ key: rateKey, label: 'rate', fmt: 'money' as const }] : []), ...extra];
  const value = (l: Raw): Part[] => cols.filter((c) => !blank(l[c.key]) && !(c.fmt !== 'qty' && money(String(l[c.key])).isZero())).map((c) => ({ label: c.label, fmt: c.fmt, v: l[c.key] }));
  const out: Diff[] = [];
  for (const k of [...new Set([...o.keys(), ...n.keys()])]) {
    const a = o.get(k) ?? [], b = n.get(k) ?? [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i], y = b[i];
      const name = String((y ?? x)!.name ?? '') || '';
      const label = `Item ${name || UNKNOWN}`;
      if (x && y) for (const c of cols) { if (!same(c.fmt, x[c.key], y[c.key])) out.push({ label: `${label}: ${c.label}`, fmt: c.fmt, old: x[c.key], new: y[c.key] }); }
      else if (y) out.push({ label, fmt: 'parts', old: null, new: value(y) });
      else if (x) out.push({ label, fmt: 'parts', old: value(x), new: null });
    }
  }
  return out;
}

/** Money set against invoices / bills: "Amount against INV-0003 changed from ₹500.00 to ₹800.00". */
function allocDiffs(before: unknown, after: unknown, idKey: 'to' | 'billId', ref: RefKind): Diff[] {
  const map = (v: unknown) => new Map(arr(v).map((a) => [String(a[idKey] ?? ''), a.amount]));
  const o = map(before), n = map(after);
  return [...new Set([...o.keys(), ...n.keys()])].flatMap((id) => {
    if (same('money', o.get(id), n.get(id))) return [];
    return [{ label: id === 'opening' ? 'Amount against the opening balance' : `Amount against {${ref}:${id}}`, fmt: 'money' as const, old: o.get(id), new: n.get(id) }];
  });
}

/** Expense lines (kept as name / qty / rate / gst / amt), paired by line order. */
function expenseLineDiffs(before: unknown, after: unknown): Diff[] {
  const o = arr(before), n = arr(after);
  const cols: { key: string; label: string; fmt: Fmt }[] = [{ key: 'qty', label: 'quantity', fmt: 'qty' }, { key: 'rate', label: 'rate', fmt: 'money' }, { key: 'gst', label: 'GST', fmt: 'pct' }, { key: 'amt', label: 'amount', fmt: 'money' }];
  const value = (l: Raw): Part[] => cols.filter((c) => !blank(l[c.key])).map((c) => ({ label: c.label, fmt: c.fmt, v: l[c.key] }));
  const out: Diff[] = [];
  for (let i = 0; i < Math.max(o.length, n.length); i++) {
    const x = o[i], y = n[i];
    const label = `Line ${String((y ?? x)!.name ?? '') || i + 1}`;
    if (x && y) {
      if (!same('text', x.name, y.name)) out.push({ label: `Line ${i + 1}: description`, fmt: 'text', old: x.name, new: y.name });
      for (const c of cols) if (!same(c.fmt, x[c.key], y[c.key])) out.push({ label: `${label}: ${c.label}`, fmt: c.fmt, old: x[c.key], new: y[c.key] });
    } else if (y) out.push({ label, fmt: 'parts', old: null, new: value(y) });
    else if (x) out.push({ label, fmt: 'parts', old: value(x), new: null });
  }
  return out;
}

/**
 * The differences one update entry records, or null when it has no usable old / new values.
 * `entity` is the audit entry's entity (sales_document, purchase_document, payment, expense, …).
 */
export function editDiffs(entity: string, beforeV: unknown, afterV: unknown): Diff[] | null {
  const before = obj(beforeV), after = obj(afterV);
  const changes = after && Array.isArray(after.changes) ? arr(after.changes) : null;
  if (changes && CHANGE_FIELDS[entity]) {
    const F = CHANGE_FIELDS[entity]!;
    return changes.flatMap((c) => {
      const field = String(c.field ?? '');
      if (field === 'lines') return expenseLineDiffs(c.old, c.new);
      const f = F[field];
      if (!f) return [];
      // a bank-to-bank entry's first account is the one the money left
      const label = entity === 'bank_entry' && field === 'accountId' && !blank(after?.toAccountId) ? 'From account' : f.label;
      return [{ label, fmt: f.fmt ?? 'text', old: c.old, new: c.new }];
    });
  }
  if (!before || !after) return null;
  if (entity === 'sales_document') {
    const kind = String(after.kind ?? before.kind ?? '');
    const bx = obj(before.extra) ?? {}, ax = obj(after.extra) ?? {};
    if (kind === 'challan') return [...fieldDiffs(CHALLAN_HEAD, before, after), ...fieldDiffs(SALE_EXTRA.filter((f) => f.key === 'transport' || f.key === 'vehicle'), bx, ax), ...lineDiffs(before, after, null)];
    if (kind === 'credit_note')
      return [...fieldDiffs(CN_HEAD, before, after), ...fieldDiffs([{ key: 'refundMode', label: 'Refund mode' }, { key: 'invoices', label: 'Against invoices', fmt: 'list' }], bx, ax), ...lineDiffs(before, after, 'price', [{ key: 'gstRate', label: 'GST', fmt: 'pct' }])];
    if (kind === 'quotation' && (ax.type === 'brand' || bx.type === 'brand')) {
      const { cust: _a, ...bRest } = bx, { cust: _b, ...aRest } = ax;
      const grid = JSON.stringify(bRest) === JSON.stringify(aRest) ? [] : [{ label: 'Brands, items and quantities', fmt: 'changedOnly' as const, old: true, new: true }];
      return [...fieldDiffs(BRAND_QUOTE_HEAD, before, after), ...grid];
    }
    const due = { key: 'dueDate', label: kind === 'quotation' ? 'Valid till' : 'Due date', fmt: 'date' as const };
    return [...fieldDiffs([SALE_HEAD[0]!, due, ...SALE_HEAD.slice(1)], before, after), ...fieldDiffs(SALE_EXTRA, bx, ax), ...lineDiffs(before, after, 'price', [{ key: 'discPct', label: 'discount', fmt: 'pct' }, { key: 'gstRate', label: 'GST', fmt: 'pct' }])];
  }
  if (entity === 'purchase_document')
    return [...fieldDiffs(PURCHASE_HEAD, before, after), ...lineDiffs(before, after, 'rate', [{ key: 'discPct', label: 'discount', fmt: 'pct' }, { key: 'gstRate', label: 'GST', fmt: 'pct' }])];
  if (entity === 'payment') {
    const out = String(after.direction ?? before.direction) === 'out';
    return [...fieldDiffs(PAYMENT_HEAD, before, after), ...(out ? allocDiffs(before.alloc, after.alloc, 'billId', 'purchase') : allocDiffs(before.allocations, after.allocations, 'to', 'sale'))];
  }
  if (CHANGE_FIELDS[entity]) {
    // a group-3 record written before `changes` was kept: compare its fields the same way
    const F = Object.entries(CHANGE_FIELDS[entity]!).map(([key, f]) => ({ key, ...f }));
    return [...fieldDiffs(F, before, after), ...(entity === 'expense' ? expenseLineDiffs(before.lines, after.lines) : [])];
  }
  return null;
}

/** Ids the differences mention, by what they stand for (to look their names up). */
export function refsOf(diffs: Diff[]): Record<RefKind, Set<string>> {
  const out = { party: new Set<string>(), item: new Set<string>(), godown: new Set<string>(), account: new Set<string>(), referrer: new Set<string>(), sale: new Set<string>(), purchase: new Set<string>() } as Record<RefKind, Set<string>>;
  for (const d of diffs) {
    if (typeof d.fmt === 'object' && 'ref' in d.fmt) for (const v of [d.old, d.new]) if (typeof v === 'string' && v) out[d.fmt.ref].add(v);
    for (const m of d.label.matchAll(/\{(\w+):([^}]+)\}/g)) out[m[1] as RefKind]?.add(m[2]!);
  }
  return out;
}

const isoDay = (v: unknown) => { const s = String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDmy(s) : String(v); };

/** One value as the window shows it: money in Indian format, dates dd/mm/yyyy, ids as names. */
export function show(fmt: Fmt, v: unknown, names: Names): string {
  if (fmt === 'money') return '₹' + formatInr2(String(v));
  if (fmt === 'qty') return formatQty(String(v));
  if (fmt === 'signedQty') { const m = money(String(v)); return (m.gt(0) ? '+' : '') + formatQty(m); }
  if (fmt === 'pct') return formatQty(String(v)) + '%';
  if (fmt === 'date') return isoDay(v);
  if (fmt === 'bool') return v ? 'Yes' : 'No';
  if (fmt === 'state') return stateName(String(v)) || String(v);
  if (fmt === 'parts' || fmt === 'changedOnly') return '';
  if (fmt === 'list') return Array.isArray(v) ? v.map(String).join(', ') : String(v);
  if (typeof fmt === 'object' && 'ref' in fmt) return names[fmt.ref].get(String(v)) ?? UNKNOWN;
  if (typeof fmt === 'object' && 'words' in fmt) return fmt.words[String(v)] ?? String(v);
  return String(v);
}

/** The sentences: "<label> changed from <old> to <new>", "<label> was added (value: <v>)", "<label> was removed (was: <v>)". */
export function sentences(diffs: Diff[], names: Names): string[] {
  const label = (s: string) => s.replace(/\{(\w+):([^}]+)\}/g, (_, k: RefKind, id: string) => names[k]?.get(id) ?? UNKNOWN);
  const val = (d: Diff, v: unknown) => (d.fmt === 'parts' ? (v as Part[]).map((p) => `${p.label} ${show(p.fmt, p.v, names)}`).join(', ') : show(d.fmt, v, names));
  return diffs.map((d) => {
    const L = label(d.label);
    if (d.fmt === 'changedOnly') return `${L} were changed`;
    // a yes / no switch is never "added" or "removed"
    if (d.fmt === 'bool') return `${L} changed from ${show('bool', d.old, names)} to ${show('bool', d.new, names)}`;
    if (blank(d.old)) return `${L} was added (value: ${val(d, d.new)})`;
    if (blank(d.new)) return `${L} was removed (was: ${val(d, d.old)})`;
    return `${L} changed from ${val(d, d.old)} to ${val(d, d.new)}`;
  });
}

/** An update entry that is not an edit of the document: a credit note noting the invoice it returns goods from. */
export const notAnEdit = (entity: string, before: unknown, after: unknown) => {
  const a = obj(after);
  return entity === 'sales_document' && !obj(before) && !!a && Object.keys(a).length === 1 && 'returned' in a;
};
