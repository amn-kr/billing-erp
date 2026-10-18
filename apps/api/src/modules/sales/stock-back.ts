import type { Tx } from '../../common/db.service';
import { day } from '../../common/lookups';

/**
 * Puts back whatever a document's movements still move, item by item and godown by godown
 * (an invoice's goods come back in, a credit note's returned goods go out again).
 * Used by cancel, delete and edit, so an edit undoes exactly what a cancel would.
 */
export async function reverseStock(tx: Tx, who: { businessId: string; userId: string }, docId: string, date: string, note: string) {
  const net = await tx.stockMovement.groupBy({ by: ['itemId', 'godownId'], where: { sourceType: 'sales_document', sourceId: docId }, _sum: { qty: true } });
  const back = net.filter((n) => n._sum.qty && !n._sum.qty.isZero());
  if (back.length)
    await tx.stockMovement.createMany({
      data: back.map((n) => ({
        businessId: who.businessId, createdBy: who.userId, sourceType: 'sales_document', sourceId: docId, itemId: n.itemId, godownId: n.godownId,
        date: day(date), qty: n._sum.qty!.neg().toFixed(3), kind: 'cancel', note,
      })),
    });
}
