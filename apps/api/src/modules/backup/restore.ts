/**
 * Restore = the latest full copy + every change after it, rebuilt in memory. A test restore stops
 * there and reports what came back; a real restore puts the result into new books (restore.service).
 */
import { randomUUID } from 'node:crypto';
import { money, sum } from '@billing/shared';
import type { TableInfo } from './tables';

export type Row = Record<string, unknown>;
export interface SnapshotBody { tables: Record<string, Row[]> }
/** s: change number, t: table, o: insert / update / delete, d: the whole row, at: when it was saved */
export interface Change { s: string; t: string; o: 'I' | 'U' | 'D'; d: Row; at?: string }
export interface ChangesBody { changes: Change[] }
/** table → primary key → row */
export type Books = Map<string, Map<string, Row>>;

export interface FileRange { afterSeq: bigint; toSeq: bigint }

/**
 * The change files a restore needs after a full copy taken at change number `snapSeq`: they must
 * follow on from each other with no gap. Returns the files in order, or what is missing.
 */
export function chainAfter<F extends FileRange>(snapSeq: bigint, files: F[]): { files: F[] } | { gap: string } {
  const need = files.filter((f) => f.toSeq > snapSeq).sort((a, b) => (a.afterSeq < b.afterSeq ? -1 : a.afterSeq > b.afterSeq ? 1 : 0));
  let at = snapSeq;
  const out: F[] = [];
  for (const f of need) {
    if (f.afterSeq > at) return { gap: `Changes ${at + 1n} to ${f.afterSeq} are missing from this backup.` };
    if (f.toSeq <= at) continue; // an older copy of changes already covered
    out.push(f);
    at = f.toSeq;
  }
  return { files: out };
}

const keyOf = (t: TableInfo, row: Row) => t.pk.map((c) => String(row[c])).join('|');

/** Rebuilds the books: the full copy, then each later change in order (a change is the whole row). */
export function replay(tables: TableInfo[], snap: SnapshotBody, snapSeq: bigint, bundles: ChangesBody[]): { books: Books; applied: number; lastAt: string | null } {
  const info = new Map(tables.map((t) => [t.name, t]));
  const books: Books = new Map(tables.map((t) => [t.name, new Map()]));
  for (const [name, rows] of Object.entries(snap.tables)) {
    const t = info.get(name);
    if (!t) continue; // a table that no longer exists
    const m = books.get(name)!;
    for (const r of rows) m.set(keyOf(t, r), r);
  }
  let applied = 0;
  let lastAt: string | null = null;
  let last = snapSeq;
  for (const b of bundles) {
    for (const c of b.changes) {
      const s = BigInt(c.s);
      if (s <= last) continue; // already in the full copy, or sent twice
      last = s;
      applied++;
      lastAt = c.at ?? lastAt;
      const t = info.get(c.t);
      if (!t) continue;
      const m = books.get(c.t)!;
      if (c.o === 'D') m.delete(keyOf(t, c.d));
      else m.set(keyOf(t, c.d), c.d);
    }
  }
  return { books, applied, lastAt };
}

/**
 * New ids for restored books: the shop and every row with a uuid `id` get a fresh id, and every
 * value anywhere in the rows that was one of the old ids is replaced (links between rows,
 * ids kept inside JSON settings and the audit log). Ids from outside the books (people, system
 * roles) stay as they are.
 */
export function remapIds(books: Books, tables: TableInfo[], oldBusinessId: string, newBusinessId: string): Books {
  const map = new Map<string, string>([[oldBusinessId.toLowerCase(), newBusinessId]]);
  for (const t of tables) {
    if (t.pk.length !== 1 || t.pk[0] !== 'id' || t.name === 'businesses') continue;
    for (const r of books.get(t.name)?.values() ?? []) if (typeof r.id === 'string') map.set(r.id.toLowerCase(), randomUUID());
  }
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') return map.get(v.toLowerCase()) ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  const out: Books = new Map();
  for (const [name, rows] of books) {
    const t = tables.find((x) => x.name === name)!;
    const m = new Map<string, Row>();
    for (const r of rows.values()) { const n = swap(r) as Row; m.set(keyOf(t, n), n); }
    out.set(name, m);
  }
  return out;
}

const live = (r: Row) => !r.cancelled_at && !r.archived_at;
const rowsOf = (books: Books, t: string) => [...(books.get(t)?.values() ?? [])];

/** What a test restore shows: the main counts and this year's sales. */
export function summarise(books: Books, fy: { start: string; end: string }) {
  const sales = rowsOf(books, 'sales_documents').filter((r) => live(r) && r.kind === 'invoice');
  const inYear = sales.filter((r) => String(r.date) >= fy.start && String(r.date) <= fy.end);
  return {
    invoices: sales.length,
    parties: rowsOf(books, 'parties').filter(live).length,
    items: rowsOf(books, 'items').filter(live).length,
    purchaseBills: rowsOf(books, 'purchase_documents').filter((r) => live(r) && r.kind === 'bill').length,
    paymentsReceived: rowsOf(books, 'payments').filter((r) => live(r) && r.direction === 'in').length,
    salesTotalThisYear: sum(inYear.map((r) => money(r.total as string | number))).toFixed(2),
  };
}

/** Rows per table, for comparing a restored copy with the books as they are now. */
export const countsOf = (books: Books) => Object.fromEntries([...books].map(([t, m]) => [t, m.size]));
