import { BadRequestException } from '@nestjs/common';
import type { Tx } from '../../common/db.service';
import { day } from '../../common/lookups';

/**
 * Puts back whatever a document's movements still move, item by item and godown by godown
 * (an invoice's goods come back in, a credit note's returned goods go out again, a purchase bill's
 * goods go out again, a debit note's come back). Used by cancel, delete and edit, so an edit undoes
 * exactly what a cancel would.
 */
export async function reverseStock(tx: Tx, who: { businessId: string; userId: string }, docId: string, date: string, note: string, sourceType: 'sales_document' | 'purchase_document' = 'sales_document') {
  const net = await tx.stockMovement.groupBy({ by: ['itemId', 'godownId', 'batchId'], where: { sourceType, sourceId: docId }, _sum: { qty: true } });
  const back = net.filter((n) => n._sum.qty && !n._sum.qty.isZero());
  if (back.length)
    await tx.stockMovement.createMany({
      data: back.map((n) => ({
        businessId: who.businessId, createdBy: who.userId, sourceType, sourceId: docId, itemId: n.itemId, godownId: n.godownId, batchId: n.batchId,
        date: day(date), qty: n._sum.qty!.neg().toFixed(3), kind: 'cancel', note,
      })),
    });
}

/**
 * Refuses to take out again goods a document brought in (a purchase bill, a credit note's returned
 * goods) when some of them have been sold since: putting them back would leave the stock below zero.
 */
export async function refuseIfSoldSince(tx: Tx, docId: string, number: string, sourceType: 'sales_document' | 'purchase_document') {
  const net = await tx.stockMovement.groupBy({ by: ['itemId', 'godownId'], where: { sourceType, sourceId: docId }, _sum: { qty: true } });
  for (const n of net) {
    if (!n._sum.qty?.gt(0)) continue;
    const now = await tx.stockMovement.aggregate({ where: { itemId: n.itemId, godownId: n.godownId }, _sum: { qty: true } });
    if (!(now._sum.qty ?? n._sum.qty).lt(n._sum.qty)) continue;
    const item = await tx.item.findFirst({ where: { id: n.itemId }, select: { name: true } });
    throw new BadRequestException({ message: `Some of it has been sold since: taking ${number}’s “${item?.name ?? 'item'}” out of stock again would make its stock negative.` });
  }
}
