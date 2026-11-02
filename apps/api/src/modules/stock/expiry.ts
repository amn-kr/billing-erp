/**
 * Expiry monitoring (Features › batch_expiry, owner's request, 2 Nov 2026). Stock and values come from the one lot
 * calculation (batchRowsOf), so they always agree with the stock value; so does the cost of what each batch sold.
 */
import { costByBatch, financialYearOf, money, stockQtyOf, type Money } from '@billing/shared';
import type { Tx } from '../../common/db.service';
import { isoOf } from '../../common/lookups';
import { allocsOf, batchRowsOf } from './batches';
import { ledgerOf } from './stock-value';

/** the reason a write-off of expired stock carries (Stock adjustments' list of reasons) */
export const EXPIRED_REASON = 'Expired';

/** Items with batches: tracked now, or tracked once. */
const batchItems = (tx: Tx) => tx.item.findMany({ where: { kind: { not: 'service' }, deletedAt: null, OR: [{ trackBatch: true }, { batches: { some: {} } }] }, include: { unit: true, packUnit: true } });

/**
 * Every batch with stock and an expiry date, earliest first, with who it was last bought from and that bill
 * (none = opening stock or added by an adjustment), and the value of expired stock written off this financial year.
 */
export async function expiryReport(tx: Tx, today: string) {
  const items = await batchItems(tx);
  const stock = await batchRowsOf(tx, items);
  const rows = items.flatMap((i) => stock.get(i.id)!.rows.filter((r) => r.id && r.expiry && money(r.qty).gt(0)).map((r) => ({ ...r, itemId: i.id, item: i.name, code: i.code, unit: i.unit?.code ?? '', packUnit: i.packUnit?.code ?? '', packSize: i.packSize?.toFixed(3) ?? null })));
  const lines = await tx.purchaseDocumentLine.findMany({
    where: { batchId: { in: rows.map((r) => r.id!) }, document: { kind: 'bill', cancelledAt: null, deletedAt: null } },
    select: { batchId: true, document: { select: { id: true, number: true, date: true, createdAt: true, party: { select: { id: true, name: true } } } } },
  });
  const last = new Map<string, (typeof lines)[number]['document']>();
  for (const l of lines) {
    const had = last.get(l.batchId!);
    if (!had || l.document.date > had.date || (l.document.date.getTime() === had.date.getTime() && l.document.createdAt > had.createdAt)) last.set(l.batchId!, l.document);
  }
  const fy = financialYearOf(today);
  const off = await tx.stockAdjustment.findMany({ where: { reason: EXPIRED_REASON, cancelledAt: null, qty: { lt: 0 } }, select: { date: true, qty: true, rate: true } });
  const writtenOff = off.filter((a) => { const d = isoOf(a.date)!; return d >= fy.start && d <= fy.end; }).reduce<Money>((a, x) => a.plus(money(x.qty.toString()).abs().times(x.rate.toString())), money(0));
  return {
    writtenOff: writtenOff.toDecimalPlaces(2).toFixed(2),
    rows: rows
      .map((r) => { const b = last.get(r.id!); return { ...r, supplierId: b?.party.id ?? null, supplier: b?.party.name ?? '', billId: b?.id ?? null, billNo: b?.number ?? '' }; })
      .sort((a, b) => a.expiry!.localeCompare(b.expiry!) || a.item.localeCompare(b.item) || a.no.localeCompare(b.no)),
  };
}

/**
 * What each batch sold in a period, after returns. Sale value: each line's value before GST and after its own discount
 * (as Party wise Profit & Loss), shared over its batches by quantity. Cost: the same lots as the stock value.
 * Cancelled documents don't count.
 */
export async function batchSales(tx: Tx, from: string, to: string) {
  const items = await batchItems(tx);
  const info = new Map(items.map((i) => [i.id, i]));
  const ledger = await ledgerOf(tx, items.map((i) => i.id));
  const costs = new Map<string, Map<string, { batchId: string | null; qty: string; cost: string }[]>>();
  for (const i of items) costs.set(i.id, costByBatch(ledger.get(i.id) ?? []));
  const docs = await tx.salesDocument.findMany({
    where: { kind: { in: ['invoice', 'credit_note'] }, cancelledAt: null, deletedAt: null, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    select: { id: true, kind: true, lines: { where: { itemId: { in: items.map((i) => i.id) } }, select: { itemId: true, qty: true, packSize: true, taxable: true, batchAlloc: true } } },
  });
  const by = new Map<string, { itemId: string; batchId: string | null; qty: Money; sale: Money; cost: Money }>();
  const row = (itemId: string, batchId: string | null) => {
    const k = `${itemId}|${batchId ?? ''}`;
    let r = by.get(k);
    if (!r) by.set(k, (r = { itemId, batchId, qty: money(0), sale: money(0), cost: money(0) }));
    return r;
  };
  for (const d of docs) {
    const sign = d.kind === 'credit_note' ? -1 : 1;
    for (const l of d.lines) {
      const whole = stockQtyOf(l.qty.toString(), l.packSize?.toString());
      const allocs = allocsOf(l.batchAlloc).length ? allocsOf(l.batchAlloc) : [{ batchId: null, qty: whole.toFixed(3) }];
      let left = money(l.taxable.toString());
      allocs.forEach((a, k) => {
        const part = k === allocs.length - 1 ? left : money(l.taxable.toString()).times(a.qty).div(whole).toDecimalPlaces(2);
        left = left.minus(part);
        const r = row(l.itemId!, a.batchId);
        r.qty = r.qty.plus(money(a.qty).times(sign));
        r.sale = r.sale.plus(part.times(sign));
      });
    }
    // a document's cost by batch, once for each item it has
    for (const id of new Set(d.lines.map((l) => l.itemId!))) {
      for (const c of costs.get(id)?.get(d.id) ?? []) { const r = row(id, c.batchId); r.cost = r.cost.plus(money(c.cost).times(sign)); }
    }
  }
  const batches = new Map((await tx.batch.findMany({ where: { itemId: { in: items.map((i) => i.id) } }, select: { id: true, batchNo: true, expiryDate: true } })).map((b) => [b.id, b]));
  return [...by.values()].filter((r) => !r.qty.isZero() || !r.sale.isZero() || !r.cost.isZero()).map((r) => {
    const i = info.get(r.itemId)!, b = r.batchId ? batches.get(r.batchId) : undefined;
    return { itemId: r.itemId, item: i.name, unit: i.unit?.code ?? '', packUnit: i.packUnit?.code ?? '', packSize: i.packSize?.toFixed(3) ?? null, batchId: r.batchId, no: b?.batchNo ?? 'No batch', expiry: isoOf(b?.expiryDate ?? null), qty: r.qty.toFixed(3), sale: r.sale.toFixed(2), cost: r.cost.toFixed(2), profit: r.sale.minus(r.cost).toFixed(2) };
  }).sort((a, b) => a.item.localeCompare(b.item) || (a.expiry ?? '9').localeCompare(b.expiry ?? '9') || a.no.localeCompare(b.no));
}
