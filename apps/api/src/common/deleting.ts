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
