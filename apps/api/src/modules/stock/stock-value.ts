import { autoPurchasePrice, costOfGoods, costRows, hasPurchaseLot, money, stockByPurchaseRate, type GoodsCost, type LedgerMove, type LineCost, type RateTable, type SaleCostInput } from '@billing/shared';
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
    tx.$queryRaw<{ item_id: string; date: string; created_at: string; qty: string; rate: string; kind: string; source_type: string; source_id: string | null; batch_id: string | null }[]>`
      SELECT item_id::text, date::text AS date, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
             qty::text, rate::text, kind, source_type, source_id::text, batch_id::text
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
    list.push({ date: m.date, createdAt: m.created_at, qty: m.qty, rate: m.rate, kind: m.kind, sourceType: m.source_type, sourceId: m.source_id, against: m.source_id ? against.get(`${m.item_id}|${m.source_id}`) : undefined, batchId: m.batch_id });
    out.set(m.item_id, list);
  }
  return out;
}

/** What is left of each item by purchase rate (first in, first out), with its stock value. */
export async function rateTables(tx: Tx, items: { id: string; purchasePrice: { toString(): string } }[], all = false): Promise<Map<string, RateTable>> {
  const ledger = await ledgerOf(tx, all ? undefined : items.map((i) => i.id));
  return new Map(items.map((i) => [i.id, stockByPurchaseRate(ledger.get(i.id) ?? [], i.purchasePrice.toString())]));
}

/**
 * One item's card: what is left by purchase rate (the stock value), and whether it ever came in with
 * a purchase rate (a bill, opening stock or added stock with a rate); without one the card shows no
 * latest / average purchase price.
 */
export async function itemLots(tx: Tx, id: string, purchasePrice: { toString(): string }): Promise<{ rateTable: RateTable; bought: boolean }> {
  const moves = (await ledgerOf(tx, [id])).get(id) ?? [];
  return { rateTable: stockByPurchaseRate(moves, purchasePrice.toString()), bought: hasPurchaseLot(moves) };
}

/**
 * Profit's cost side, from the same lots as the stock value (owner's rule, Oct 2026): what each
 * sale's goods cost and what each sale return put back, keyed `itemId|documentId`. Every place that
 * shows a profit gets its cost from here or from draftSaleCosts, so they all agree.
 */
export async function goodsCosts(tx: Tx, itemIds?: string[]): Promise<Map<string, GoodsCost>> {
  const ledger = await ledgerOf(tx, itemIds);
  const out = new Map<string, GoodsCost>();
  for (const [itemId, moves] of ledger) for (const [doc, c] of costOfGoods(moves)) out.set(`${itemId}|${doc}`, c);
  return out;
}

/** A document's cost of goods: its lines' costs added up (services and lines without an item cost 0). */
export function documentCost(costs: Map<string, GoodsCost>, docId: string, lines: { itemId: string | null }[]) {
  return [...new Set(lines.map((l) => l.itemId).filter((i): i is string => !!i))].reduce((a, i) => a.plus(costs.get(`${i}|${docId}`)?.cost ?? 0), money(0));
}

/**
 * The cost of each line of a bill still on screen (the sale editor's profit & loss pop-up), with a
 * row per lot it uses: its goods leave the lots on its date, after what was entered before; an
 * invoice being edited is left out and counted at the place it already has, so an unchanged saved
 * bill shows what the reports show.
 */
export async function draftSaleCosts(tx: Tx, d: SaleCostInput) {
  const ids = [...new Set(d.lines.map((l) => l.itemId).filter((i): i is string => !!i))];
  const goods = new Set((await tx.item.findMany({ where: { id: { in: ids }, kind: { not: 'service' } }, select: { id: true } })).map((i) => i.id));
  const ledger = await ledgerOf(tx, [...goods]);
  const own = d.id ? (await tx.stockMovement.findMany({ where: { sourceType: 'sales_document', sourceId: d.id }, select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 }))[0] : undefined;
  // the ledger's own time format (microseconds); a new bill comes after everything entered so far
  const at = (own?.createdAt ?? new Date()).toISOString().replace('Z', own ? '000Z' : '999Z');
  const src = d.id ?? 'this-bill';
  // lines that use no stock (no item, a service): one row at 0
  const out: LineCost[] = d.lines.map((l) => costRows(undefined, [l.qty])[0]!);
  for (const itemId of goods) {
    const rows = d.lines.flatMap((l, k) => (l.itemId === itemId && money(l.qty).gt(0) ? [k] : []));
    if (!rows.length) continue;
    const moves: LedgerMove[] = [
      ...(ledger.get(itemId) ?? []).filter((m) => !d.id || m.sourceId !== d.id),
      ...rows.map((k) => ({ date: d.date, createdAt: at, qty: money(d.lines[k]!.qty).neg().toFixed(3), rate: '0', kind: 'sale', sourceType: 'sales_document', sourceId: src })),
    ];
    const per = costRows(costOfGoods(moves).get(src), rows.map((k) => d.lines[k]!.qty));
    rows.forEach((k, j) => (out[k] = per[j]!));
  }
  return { lines: out };
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
