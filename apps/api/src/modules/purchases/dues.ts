import { money, type Money } from '@billing/shared';
import type { Tx } from '../../common/db.service';

/**
 * What is still to pay on each purchase bill: total − payments made and debit notes set
 * against it. A cancelled payment or debit note no longer counts; a cancelled bill owes nothing.
 * `skip` leaves out what one payment made settled (the one open in its edit window).
 */
export async function billBalances(tx: Tx, ids?: string[], skip?: string): Promise<Map<string, Money>> {
  const rows = await tx.$queryRaw<{ id: string; bal: string }[]>`
    SELECT d.id, CASE WHEN d.cancelled_at IS NOT NULL THEN 0 ELSE d.total - coalesce(s.used, 0) END::text AS bal
    FROM purchase_documents d
    LEFT JOIN (
      SELECT a.purchase_document_id AS id, sum(a.amount) AS used
      FROM payment_allocations a
      LEFT JOIN payments p ON p.id = a.payment_id
      LEFT JOIN purchase_documents n ON n.id = a.note_id
      WHERE a.purchase_document_id IS NOT NULL AND p.cancelled_at IS NULL AND n.cancelled_at IS NULL
        AND (${skip ?? null}::uuid IS NULL OR coalesce(a.payment_id, a.note_id) <> ${skip ?? null}::uuid)
      GROUP BY a.purchase_document_id
    ) s ON s.id = d.id
    WHERE d.kind = 'bill' AND (${ids ?? null}::uuid[] IS NULL OR d.id = ANY(${ids ?? null}::uuid[]))`;
  return new Map(rows.map((r) => [r.id, money(r.bal)]));
}

/** Money on a payment made (or credit on a debit note) not set against a live bill: the advance / unused credit. */
export async function usedOut(tx: Tx, kind: 'payment' | 'note', ids: string[]): Promise<Map<string, Money>> {
  if (!ids.length) return new Map();
  const col = kind === 'payment' ? 'payment_id' : 'note_id';
  const rows = await tx.$queryRawUnsafe<{ id: string; used: string }[]>(
    `SELECT a.${col} AS id, sum(a.amount)::text AS used
     FROM payment_allocations a LEFT JOIN purchase_documents d ON d.id = a.purchase_document_id
     WHERE a.${col} = ANY($1::uuid[]) AND (d.id IS NULL OR d.cancelled_at IS NULL)
     GROUP BY a.${col}`,
    ids,
  );
  return new Map(rows.map((r) => [r.id, money(r.used)]));
}

/**
 * What payments out and debit notes already settle on a bill, leaving out the money paid with the
 * bill itself (an edit of the bill writes that again). An edited bill can't be less than this.
 */
export async function settledElsewhere(tx: Tx, billId: string): Promise<{ amount: Money; numbers: string[] }> {
  const allocs = await tx.paymentAllocation.findMany({ where: { purchaseDocumentId: billId }, include: { payment: true }, orderBy: { createdAt: 'asc' } });
  const notes = new Map((await tx.purchaseDocument.findMany({ where: { id: { in: allocs.flatMap((a) => (a.noteId ? [a.noteId] : [])) } }, select: { id: true, number: true, cancelledAt: true } })).map((n) => [n.id, n]));
  const live = allocs.filter((a) => (a.payment ? !a.payment.cancelledAt && !(a.payment.atSale && a.payment.sourceId === billId) : !!a.noteId && !notes.get(a.noteId)?.cancelledAt));
  return {
    amount: live.reduce((s, a) => s.plus(money(a.amount.toString())), money(0)),
    numbers: [...new Set(live.map((a) => a.payment?.number ?? notes.get(a.noteId!)?.number ?? ''))].filter(Boolean),
  };
}
