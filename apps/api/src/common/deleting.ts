/**
 * Delete for saved documents. Delete never erases a row: the document's own cancel undoes its
 * effects (stock, party balance, payments, the books) and sets cancelled_at, so every total already
 * leaves it out exactly like a cancelled one; then it is marked deleted, which hides it from the
 * normal lists. The row stays in the database and in every backup, and its number is never given again.
 *
 * A live document that is deleted gets cancelled_at = deleted_at (the same moment); one cancelled
 * earlier keeps its own cancelled_at. A later Restore (Blue Bin) can tell the two apart from that.
 *
 * Adding a document type: give its table deleted_at / deleted_by / delete_reason, run its cancel
 * with the same `at`, then save deleteMark() and write a 'delete' audit entry.
 */
import type { RequestContext } from './context';

export const ALREADY_DELETED = 'Already deleted';

/** The columns a delete sets. */
export const deleteMark = (ctx: RequestContext, reason: string, at: Date) => ({ deletedAt: at, deletedBy: ctx.userId, deleteReason: reason });

/*
 * Items and parties (Oct 2026): Delete only when never used. An opening stock or opening balance alone
 * doesn't count: it is put back (stock) or set to zero (balance). Like a document the row is kept: it
 * is made inactive (archived_at, so its name is free again) and marked deleted (hidden from "Show
 * inactive" too). Used ones are refused with what uses them, and can be made inactive instead.
 */

/** How many of a kind, e.g. count(3, 'sale invoice') = "3 sale invoices"; nothing when 0. */
export const count = (n: number, one: string, many = one + 's') => (n ? [`${n} ${n === 1 ? one : many}`] : []);

/** "a", "a and b", "a, b and c" */
export const andList = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

/** What a refused delete says, e.g. "LED bulb is used in 3 sale invoices, so it can't be deleted. …" */
export const usedMessage = (name: string, uses: string[], where: string) =>
  `${name} is used in ${andList(uses)}, so it can’t be deleted. You can make it inactive instead: it is hidden from ${where}, and stays on old ones.`;
