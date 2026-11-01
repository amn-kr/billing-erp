import { BadRequestException } from '@nestjs/common';
import { batchMonth, formatQty, money, parseBatchDate, sortBatches, stockByBatch, todayIst, type BatchRow, type Money } from '@billing/shared';
import type { AuditService } from '../../common/audit.service';
import type { Tx } from '../../common/db.service';
import { day, isoOf } from '../../common/lookups';
import { ledgerOf } from './stock-value';

interface Who { businessId: string; userId: string; ip?: string }
export interface BatchEntry { batchNo?: string | null; mfg?: string | null; expiry?: string | null }

/** Whether this shop's owner has turned on Batch and expiry; with it off, batch data sent is ignored. */
export async function batchesOn(tx: Tx, businessId: string): Promise<boolean> {
  return !!(await tx.businessSettings.findUnique({ where: { businessId }, select: { features: true } }))?.features.includes('batch_expiry');
}

/** The dates typed for a batch, as ISO dates, or a clear refusal. */
export function batchDates(e: BatchEntry): { mfg: string | null; expiry: string | null } {
  const mfg = parseBatchDate(e.mfg, 'mfg'), expiry = parseBatchDate(e.expiry, 'expiry');
  if (mfg === undefined) throw new BadRequestException({ message: `“${e.mfg}” isn’t a date. Type the mfg date like 01/26.`, field: 'mfg' });
  if (expiry === undefined) throw new BadRequestException({ message: `“${e.expiry}” isn’t a date. Type the expiry like 03/27.`, field: 'expiry' });
  if (mfg && expiry && expiry < mfg) throw new BadRequestException({ message: `Batch ${e.batchNo ?? ''}: the expiry is before the mfg date.`.replace('  ', ' '), field: 'expiry' });
  return { mfg, expiry };
}

/**
 * The batch with this no. for the item, made the first time it is used. The same batch no. always has
 * the same dates (owner, 1 Nov 2026): different ones are refused, and a date still empty is filled in.
 * Fixing a wrong date is done from the item card (Stock by batch › Edit).
 */
export async function resolveBatch(tx: Tx, who: Who, audit: AuditService, item: { id: string; name: string }, e: BatchEntry): Promise<string> {
  const no = (e.batchNo ?? '').trim();
  const { mfg, expiry } = batchDates(e);
  const old = await tx.batch.findFirst({ where: { itemId: item.id, batchNo: { equals: no, mode: 'insensitive' } } });
  if (!old) {
    const b = await tx.batch.create({ data: { businessId: who.businessId, createdBy: who.userId, itemId: item.id, batchNo: no, mfgDate: mfg ? day(mfg) : null, expiryDate: expiry ? day(expiry) : null } });
    await audit.log(tx, { businessId: who.businessId, userId: who.userId, action: 'create', entity: 'batch', entityId: b.id, after: b, ip: who.ip });
    return b.id;
  }
  const had = { mfg: isoOf(old.mfgDate), expiry: isoOf(old.expiryDate) };
  if (expiry && had.expiry && expiry !== had.expiry)
    throw new BadRequestException({ message: `Batch ${old.batchNo} of “${item.name}” already has expiry ${batchMonth(had.expiry)}. Use that, or change it on the item card.`, field: 'expiry' });
  if (mfg && had.mfg && mfg !== had.mfg)
    throw new BadRequestException({ message: `Batch ${old.batchNo} of “${item.name}” already has mfg date ${batchMonth(had.mfg)}. Use that, or change it on the item card.`, field: 'mfg' });
  if ((expiry && !had.expiry) || (mfg && !had.mfg)) {
    const b = await tx.batch.update({ where: { id: old.id }, data: { ...(expiry && !had.expiry && { expiryDate: day(expiry) }), ...(mfg && !had.mfg && { mfgDate: day(mfg) }) } });
    await audit.log(tx, { businessId: who.businessId, userId: who.userId, action: 'update', entity: 'batch', entityId: b.id, before: old, after: b, ip: who.ip });
  }
  return old.id;
}

/** An item's stock by batch from its stock ledger (the one lot calculation), in the order they are used. */
export async function batchRows(tx: Tx, item: { id: string; purchasePrice: { toString(): string } }): Promise<{ rows: BatchRow[]; shortQty: string }> {
  const moves = (await ledgerOf(tx, [item.id])).get(item.id) ?? [];
  const { rows, shortQty } = stockByBatch(moves, item.purchasePrice.toString());
  const info = new Map((await tx.batch.findMany({ where: { itemId: item.id } })).map((b) => [b.id, b]));
  const out: BatchRow[] = rows.map((r) => {
    const b = r.batchId ? info.get(r.batchId) : undefined;
    return { id: r.batchId, no: b?.batchNo ?? 'No batch', mfg: isoOf(b?.mfgDate ?? null), expiry: isoOf(b?.expiryDate ?? null), qty: r.qty, rate: r.rate, value: r.value };
  });
  return { rows: sortBatches(out, todayIst()), shortQty };
}

/** How much is in a batch (or with no batch), refused if it is less than wanted. */
export function refuseOverBatch(rows: BatchRow[], batchId: string | null, want: Money, itemName: string, what: string): void {
  const r = rows.find((x) => x.id === batchId);
  const have = money(r?.qty ?? 0);
  if (have.lt(want))
    throw new BadRequestException({ message: `Only ${formatQty(have)} of “${itemName}” ${batchId ? `in batch ${r?.no ?? ''}`.trimEnd() : 'without a batch'} ${what}.`.replace('  ', ' ') });
}

/**
 * After a bill or adjustment that brought goods into these batches was changed or cancelled: refused
 * when a batch would end below zero because its goods were sold since.
 */
export async function refuseIfBatchShort(tx: Tx, batchIds: (string | null | undefined)[], number: string): Promise<void> {
  const ids = [...new Set(batchIds.filter((i): i is string => !!i))];
  if (!ids.length) return;
  const net = await tx.stockMovement.groupBy({ by: ['batchId'], where: { batchId: { in: ids } }, _sum: { qty: true } });
  const bad = net.find((n) => n._sum.qty?.lt(0));
  if (!bad) return;
  const b = await tx.batch.findFirst({ where: { id: bad.batchId! }, include: { item: { select: { name: true } } } });
  throw new BadRequestException({ message: `Some of batch ${b?.batchNo ?? ''} of “${b?.item.name ?? 'item'}” has been sold since, so ${number} can’t take it out of stock.` });
}
