/**
 * Items › Bulk update items: the fields that can be changed for many items at once, the request the
 * server takes (only the changed rows, each with only its changed fields) and the checks the screen
 * makes before anything is sent. The server checks every row again with the same item rules as
 * editing one item (itemUpdateSchema and the items service).
 */
import { z } from 'zod';
import { money } from './money.js';
import { itemUpdateSchema } from './masters.js';

/** The screen's tabs. Stock comes in a later change. */
export const BULK_TABS = [
  { key: 'pricing', title: 'Pricing' },
  { key: 'info', title: 'Item Information' },
] as const;
export type BulkTab = (typeof BULK_TABS)[number]['key'];

/** Item fields the screen can change, as named in the item API. */
export const BULK_FIELDS = ['category', 'purchase', 'sale', 'gstRate', 'code'] as const;
export type BulkField = (typeof BULK_FIELDS)[number];

/** Which tab a field's change is counted under (Category is on both: counted where it was changed). */
export const BULK_FIELD_TAB: Record<Exclude<BulkField, 'category'>, BulkTab> = { purchase: 'pricing', sale: 'pricing', gstRate: 'pricing', code: 'info' };

export const BULK_MAX_ROWS = 5000;

/** One changed item: its id and only the fields that changed, checked with the single item edit's rules. */
export const bulkItemRowSchema = itemUpdateSchema
  .pick({ category: true, purchase: true, sale: true, gstRate: true, code: true })
  .extend({ id: z.string().uuid('That item was not found.') })
  .refine((r) => BULK_FIELDS.some((f) => r[f] !== undefined), 'Each row needs at least one change.');

export const bulkItemsSchema = z.object({
  rows: z
    .array(bulkItemRowSchema)
    .min(1, 'Nothing has changed.')
    .max(BULK_MAX_ROWS, `Up to ${BULK_MAX_ROWS.toLocaleString('en-IN')} items can be updated at once.`)
    .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, 'An item is listed twice.'),
});
export type BulkItemsInput = z.infer<typeof bulkItemsSchema>;

/** What the server answers when every row was saved. */
export interface BulkItemsResult { updated: number }

/**
 * A typed amount: plain digits ("125000.5") or Indian grouping ("1,25,000.50"), at most 2 decimals.
 * Returns the plain number as text, '' for a blank cell, or null when it is not such a number.
 */
export function parseInrAmount(text: string): string | null {
  const t = text.replace(/[₹\s]/g, '');
  if (t === '') return '';
  if (!/^-?(\d+|\d{1,2}(,\d{2})*,\d{3})(\.\d{1,2})?$/.test(t)) return null;
  return t.replace(/,/g, '');
}

/** What the screen knows about an item to check a change against. */
export interface BulkItemFacts { id: string; name: string; code: string; mrp: string }

/**
 * The problem with a typed value, in plain words, or null when it can be saved. `codes` holds every
 * other item's code (lower case, with the changes typed on the screen), for the item code check.
 */
export function bulkCellProblem(field: BulkField, text: string, item: BulkItemFacts, codes: Set<string>, mrpLabel = (v: string) => v): string | null {
  if (field === 'purchase' || field === 'sale') {
    const v = parseInrAmount(text);
    if (v === null) {
      const t = text.replace(/[₹\s,]/g, '');
      if (/^-\d/.test(t)) return 'A price can’t be below zero.';
      if (/^\d+\.\d{3,}$/.test(t)) return 'Use at most 2 decimals.';
      return 'Enter a number, like 1,25,000.50.';
    }
    if (v !== '' && money(v).lt(0)) return 'A price can’t be below zero.';
    if (v !== '' && money(v).gte('1000000000000')) return 'This price is too large.';
    if (field === 'sale' && v !== '' && money(item.mrp).gt(0) && money(v).gt(item.mrp)) return `Sale price can’t be above MRP (${mrpLabel(item.mrp)}).`;
    return null;
  }
  if (field === 'code') {
    const c = text.trim();
    if (c.length > 60) return 'An item code has up to 60 characters.';
    if (c && codes.has(c.toLowerCase())) return 'This item code is already used.';
    return null;
  }
  if (field === 'category') return text.trim().length > 80 ? 'A category name has up to 80 characters.' : null;
  const g = Number(text);
  return text.trim() === '' || !Number.isFinite(g) || g < 0 || g > 100 ? 'Choose a tax slab.' : null;
}

/** True when the typed value means the same as the saved one (so it is not a change). */
export function bulkSame(field: BulkField, saved: string, text: string): boolean {
  if (field === 'purchase' || field === 'sale') {
    const v = parseInrAmount(text);
    return v !== null && money(v || 0).eq(money(saved || 0));
  }
  if (field === 'gstRate') return Number(saved) === Number(text);
  return saved.trim() === text.trim();
}
