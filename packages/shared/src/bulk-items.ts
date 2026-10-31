/**
 * Items › Bulk update items: the fields that can be changed for many items at once, the request the
 * server takes (only the changed rows, each with only its changed fields) and the checks the screen
 * makes before anything is sent. The server checks every row again with the same item rules as
 * editing one item (itemUpdateSchema and the items service). Prices are changed in Price manager,
 * never here: a request with any other field is refused.
 */
import { z } from 'zod';
import { itemUpdateSchema } from './masters.js';

/** Item fields the screen can change, as named in the item API, in the order of its columns. */
export const BULK_FIELDS = ['category', 'code', 'description', 'gstRate'] as const;
export type BulkField = (typeof BULK_FIELDS)[number];

export const BULK_MAX_ROWS = 5000;

/** One changed item: its id and only the fields that changed, checked with the single item edit's rules. */
export const bulkItemRowSchema = itemUpdateSchema
  .pick({ category: true, code: true, description: true, gstRate: true })
  .extend({ id: z.string().uuid('That item was not found.') })
  .strict('Only category, item code, description and tax slab can be changed here. Prices are changed in Price manager.')
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
 * The problem with a typed value, in plain words, or null when it can be saved. `codes` holds every
 * other item's code (lower case, with the changes typed on the screen), for the item code check;
 * `rates` the shop's tax slabs ("18", "5" …).
 */
export function bulkCellProblem(field: BulkField, text: string, codes: Set<string>, rates: string[]): string | null {
  if (field === 'code') {
    const c = text.trim();
    if (c.length > 60) return 'Up to 60 characters.';
    if (c && codes.has(c.toLowerCase())) return 'Used by another item.';
    return null;
  }
  if (field === 'category') return text.trim().length > 80 ? 'Up to 80 characters.' : null;
  if (field === 'description') return text.trim().length > 500 ? 'Up to 500 characters.' : null;
  return rates.some((r) => Number(r) === Number(text)) && text.trim() !== '' ? null : 'Choose a tax slab.';
}

/** True when the typed value means the same as the saved one (so it is not a change). */
export function bulkSame(field: BulkField, saved: string, text: string): boolean {
  if (field === 'gstRate') return Number(saved) === Number(text);
  return saved.trim() === text.trim();
}

/** Items › Bulk active / inactive: how many items one request can change. */
export const BULK_ACTIVE_MAX = 500;

/** The ticked items and what they become; the server changes all of them or none. */
export const bulkActiveSchema = z
  .object({
    ids: z
      .array(z.string().uuid('That item was not found.'))
      .min(1, 'Select at least one item.')
      .max(BULK_ACTIVE_MAX, `Up to ${BULK_ACTIVE_MAX} items can be changed at once.`)
      .refine((ids) => new Set(ids).size === ids.length, 'An item is listed twice.'),
    active: z.boolean(),
  })
  .strict();
export type BulkActiveInput = z.infer<typeof bulkActiveSchema>;

/** changed: made active / inactive now; skipped: already were */
export interface BulkActiveResult { changed: number; skipped: number }
