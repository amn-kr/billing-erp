import { autoPurchasePrice, stockByPurchaseRate, type LedgerMove, type RateTable } from '@billing/shared';
import { Prisma } from '@prisma/client';
import type { Tx } from '../../common/db.service';

/**
 * The stock ledger of many items in a few queries (all their movements, oldest first, and the
 * invoices / bills their credit and debit notes return against), ready for the shared lot maths.
 * Every screen that shows a stock value gets it from here, so they all agree (owner's rule).
 * Without ids it reads every item of the shop.
 */
export async function ledgerOf(tx: Tx, itemIds?: string[]): Promise<Map<string, LedgerMove[]>> {
  const where = itemIds ? { itemId: { in: itemIds } } : {};
  // plain text columns: thousands of rows read much faster than as Prisma Decimal objects (row-level security still applies)
  const filter = itemIds ? Prisma.sql`WHERE item_id = ANY(${itemIds}::uuid[])` : Prisma.empty;
  const [moves, sLines, pLines] = await Promise.all([
    tx.$queryRaw<{ item_id: string; date: string; created_at: string; qty: string; rate: string; kind: string; source_type: string; source_id: string | null }[]>`
      SELECT item_id::text, date::text AS date, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
             qty::text, rate::text, kind, source_type, source_id::text
      FROM stock_movements ${filter} ORDER BY date, created_at`,
    tx.salesDocumentLine.findMany({ where: { ...where, againstId: { not: null } }, select: { itemId: true, documentId: true, againstId: true } }),
    tx.purchaseDocumentLine.findMany({ where: { ...where, againstId: { not: null } }, select: { itemId: true, documentId: true, againstId: true } }),
  ]);
  const against = new Map<string, string[]>();
  for (const l of [...sLines, ...pLines]) {
    const k = `${l.itemId}|${l.documentId}`;
    against.set(k, [...(against.get(k) ?? []), l.againstId!]);
  }
  const out = new Map<string, LedgerMove[]>();
  for (const m of moves) {
    const list = out.get(m.item_id) ?? [];
    list.push({ date: m.date, createdAt: m.created_at, qty: m.qty, rate: m.rate, kind: m.kind, sourceType: m.source_type, sourceId: m.source_id, against: m.source_id ? against.get(`${m.item_id}|${m.source_id}`) : undefined });
    out.set(m.item_id, list);
  }
  return out;
}

/** What is left of each item by purchase rate (first in, first out), with its stock value. */
export async function rateTables(tx: Tx, items: { id: string; purchasePrice: { toString(): string } }[], all = false): Promise<Map<string, RateTable>> {
  const ledger = await ledgerOf(tx, all ? undefined : items.map((i) => i.id));
  return new Map(items.map((i) => [i.id, stockByPurchaseRate(ledger.get(i.id) ?? [], i.purchasePrice.toString())]));
}

/** price history entries written by refreshPurchasePrices start with this */
export const AUTO = 'Automatic · ';

/**
 * When the ledger no longer has any rate (e.g. the item's only bill was cancelled): the price the
 * item had before the automatic changes began, or null to keep what is stored (no automatic change
 * since the last change by hand, or none at all).
 */
async function priceBeforeAuto(tx: Tx, itemId: string): Promise<string | null> {
  const rows = await tx.priceHistory.findMany({ where: { itemId, field: 'purchase' }, orderBy: { createdAt: 'desc' }, select: { how: true, oldValue: true } });
  let base: string | null = null;
  for (const r of rows) {
    if (!r.how.startsWith(AUTO)) break;
    base = r.oldValue ? r.oldValue.toFixed(2) : '0.00';
  }
  return base;
}

/**
 * Keeps the item's purchase price automatic (owner's rule, Oct 2026): the newest purchase bill's
 * rate, else the opening stock's rate. Runs after a purchase bill is saved, edited or cancelled, and
 * when an item is made with opening stock. When the ledger has no rate the stored price is kept
 * (old items keep theirs). Each change goes to the price history with `how`, except when importing
 * an old backup (`history: false`: imported prices are where the books start, not changes).
 */
export async function refreshPurchasePrices(tx: Tx, who: { businessId: string; userId: string }, itemIds: (string | null)[], how: string, opts: { history?: boolean } = {}): Promise<number> {
  const ids = [...new Set(itemIds.filter((i): i is string => !!i))];
  if (!ids.length) return 0;
  const [ledger, items] = await Promise.all([ledgerOf(tx, ids), tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, purchasePrice: true } })]);
  let changed = 0;
  for (const it of items) {
    const ov = it.purchasePrice.toFixed(2);
    const nv = autoPurchasePrice(ledger.get(it.id) ?? []) ?? (await priceBeforeAuto(tx, it.id));
    if (nv === null || nv === ov) continue;
    await tx.item.update({ where: { id: it.id }, data: { purchasePrice: nv } });
    if (opts.history !== false) await tx.priceHistory.create({ data: { businessId: who.businessId, itemId: it.id, field: 'purchase', oldValue: ov, newValue: nv, how: `${AUTO}${how}`, createdBy: who.userId } });
    changed++;
  }
  return changed;
}
