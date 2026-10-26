import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ITEM_PREFIX, ITEM_PREFIX_DEFAULT, money, todayIst, toDb, type BulkActiveInput, type BulkActiveResult, type BulkItemsInput, type BulkItemsResult, type ItemInput } from '@billing/shared';
import type { Prisma } from '@prisma/client';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { fieldChanges } from '../../common/editing';
import { ALREADY_DELETED, count, usedMessage } from '../../common/deleting';
import type { RequestContext } from '../../common/context';
import { day, isoOf, namedId, unitIdFor, uniqueMessage } from '../../common/lookups';
import { invoiceBalances } from '../sales/dues';
import { withoutEditedLines } from './item-history';
import { itemLots, rateTables } from '../stock/stock-value';

const include = { unit: true, secondaryUnit: true, category: true, brand: true, itemGroup: true } satisfies Prisma.ItemInclude;
type Row = Prisma.ItemGetPayload<{ include: typeof include }>;
const q3 = (v: Prisma.Decimal | string | number) => money(v.toString()).toDecimalPlaces(3).toFixed(3);
/** the fields of an item whose old and new values an edit's audit entry keeps */
const ITEM_AUDIT_FIELDS = ['name', 'kind', 'code', 'hsn', 'unit', 'secondaryUnit', 'unitRate', 'category', 'brand', 'group', 'series', 'gstRate', 'sale', 'purchase', 'mrp', 'listPrice', 'wholesale', 'wholesaleMinQty', 'minStock', 'location', 'description'];

export function itemView(i: Row, stock: Prisma.Decimal | string | null) {
  const st = i.kind === 'service' ? null : q3(stock ?? '0');
  const min = money(i.minStock.toString());
  return {
    id: i.id, kind: i.kind, name: i.name, code: i.code, hsn: i.hsn, unit: i.unit?.code ?? '', category: i.category?.name ?? '',
    secondaryUnit: i.secondaryUnit?.code ?? '', unitRate: i.unitRate ? q3(i.unitRate) : null,
    brand: i.brand?.name ?? '', group: i.itemGroup?.name ?? '', series: i.series, gstRate: money(i.gstRate.toString()).toFixed(2),
    sale: toDb(i.salePrice.toString()), purchase: toDb(i.purchasePrice.toString()), mrp: toDb(i.mrp.toString()), listPrice: toDb(i.listPrice.toString()),
    wholesale: toDb(i.wholesalePrice.toString()), wholesaleMinQty: q3(i.wholesaleMinQty), minStock: q3(i.minStock), location: i.location, description: i.description,
    stock: st,
    /** ok | low (at or below minimum) | out (none left) — prototype lvl() */
    level: st === null ? 'ok' : money(st).lte(0) ? 'out' : min.gt(0) && money(st).lt(min) ? 'low' : 'ok',
    archived: !!i.archivedAt, createdAt: i.createdAt, legacyId: i.legacyId,
  };
}

/** Current stock per item (all godowns), from the stock ledger. */
export async function stockByItem(tx: Tx, itemIds?: string[]): Promise<Map<string, Prisma.Decimal>> {
  const rows = await tx.stockMovement.groupBy({ by: ['itemId'], _sum: { qty: true }, ...(itemIds ? { where: { itemId: { in: itemIds } } } : {}) });
  return new Map(rows.map((r) => [r.itemId, r._sum.qty!]));
}

@Injectable()
export class ItemsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  list(ctx: RequestContext, q: { search?: string; kind?: string; category?: string; brand?: string; level?: string; archived?: boolean | 'all' }) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const s = q.search?.trim();
      const rows = await tx.item.findMany({
        where: {
          ...(q.archived !== 'all' && { archivedAt: q.archived ? { not: null } : null }), deletedAt: null,
          ...(q.kind === 'goods' || q.kind === 'service' ? { kind: q.kind } : {}),
          ...(q.category ? { category: { name: q.category } } : {}),
          ...(q.brand ? { brand: { name: q.brand } } : {}),
          ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, { code: { contains: s, mode: 'insensitive' } }, { hsn: { startsWith: s } }] } : {}),
        },
        include,
        // newest first, like the prototype (IT.unshift)
        orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
      });
      const stock = await stockByItem(tx);
      // stock value by purchase-rate lots (first in, first out): the same maths as the item card's table
      const goods = rows.filter((i) => i.kind === 'goods');
      const lots = await rateTables(tx, goods, goods.length > 200);
      const out = rows.map((i) => {
        const t = lots.get(i.id);
        return { ...itemView(i, stock.get(i.id) ?? null), value: t ? t.value : null, avgRate: t ? t.avgRate : null };
      });
      return q.level ? out.filter((i) => (q.level === 'low' ? i.level !== 'ok' : i.level === q.level)) : out;
    });
  }

  private async find(tx: Tx, id: string) {
    const i = await tx.item.findFirst({ where: { id }, include });
    if (!i) throw new NotFoundException({ message: 'That item was not found.' });
    return i;
  }

  private async view(tx: Tx, id: string) {
    const i = await this.find(tx, id);
    return itemView(i, (await stockByItem(tx, [id])).get(id) ?? null);
  }

  get(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const item = await this.view(tx, id);
      const movements = await tx.stockMovement.findMany({ where: { itemId: id }, include: { godown: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
      const byGodown = await tx.stockMovement.groupBy({ by: ['godownId'], where: { itemId: id }, _sum: { qty: true } });
      const godowns = await tx.godown.findMany({ where: { archivedAt: null } });
      const adjIds = movements.filter((m) => m.sourceType === 'stock_adjustment' && m.sourceId).map((m) => m.sourceId!);
      const trfIds = movements.filter((m) => m.sourceType === 'stock_transfer' && m.sourceId).map((m) => m.sourceId!);
      const adjs = new Map((await tx.stockAdjustment.findMany({ where: { id: { in: adjIds } } })).map((a) => [a.id, a]));
      const trfs = new Map((await tx.stockTransfer.findMany({ where: { id: { in: trfIds } } })).map((t) => [t.id, t]));
      // invoices, credit notes and bills behind sale / return / purchase rows: their number, party and (invoices) paid status
      const ids = (t: string) => [...new Set(movements.filter((m) => m.sourceType === t && m.sourceId).map((m) => m.sourceId!))];
      const sdocs = new Map((await tx.salesDocument.findMany({ where: { id: { in: ids('sales_document') } }, select: { id: true, number: true, kind: true, total: true, cancelledAt: true, deletedAt: true, cashName: true, billName: true, party: { select: { name: true } } } })).map((d) => [d.id, d]));
      const pdocs = new Map((await tx.purchaseDocument.findMany({ where: { id: { in: ids('purchase_document') } }, select: { id: true, number: true, party: { select: { name: true } } } })).map((d) => [d.id, d]));
      const bal = await invoiceBalances(tx, [...sdocs.values()].filter((d) => d.kind === 'invoice').map((d) => d.id));
      const refOf = (m: (typeof movements)[number]) => (m.sourceId ? adjs.get(m.sourceId)?.number ?? trfs.get(m.sourceId)?.number ?? sdocs.get(m.sourceId)?.number ?? pdocs.get(m.sourceId)?.number ?? '' : '');
      const partyOf = (m: (typeof movements)[number]) => {
        if (!m.sourceId) return '';
        const s = sdocs.get(m.sourceId);
        if (s) return s.party?.name ?? (s.billName || s.cashName || 'Walk-in customer');
        return pdocs.get(m.sourceId)?.party.name ?? '';
      };
      /** prototype item tx "st": an invoice's paid state, Returned, Cancelled; blank otherwise */
      const statusOf = (m: (typeof movements)[number]) => {
        const s = m.sourceId ? sdocs.get(m.sourceId) : undefined;
        if (m.kind === 'cancel' && (s || (m.sourceId && pdocs.has(m.sourceId)))) return 'Cancelled';
        if (m.kind === 'return') return 'Returned';
        if (m.kind !== 'sale' || !s) return '';
        if (s.cancelledAt) return 'Cancelled';
        const b = bal.get(s.id) ?? money(0);
        return b.lte(0) ? 'Paid' : b.lt(money(s.total.toString())) ? 'Partly paid' : 'Unpaid';
      };
      return {
        ...item,
        /** what is left in stock by the purchase rate it was bought at (first in, first out) */
        ...(item.kind === 'service' ? { rateTable: null, bought: false } : await itemLots(tx, id, item.purchase)),
        godowns: godowns.map((g) => ({ id: g.id, name: g.name, stock: q3(byGodown.find((b) => b.godownId === g.id)?._sum.qty ?? '0') })),
        // a deleted document's movements (taken out and put back) still count in the stock, but aren't listed;
        // nor are the lines an edit replaced (its reversal and what that put back: see item-history.ts)
        movements: withoutEditedLines(movements.filter((m) => !(m.sourceId && sdocs.get(m.sourceId)?.deletedAt))).map((m) => ({ id: m.id, date: isoOf(m.date), kind: m.kind, qty: q3(m.qty), rate: toDb(m.rate.toString()), godown: m.godown.name, note: m.note, sourceType: m.sourceType, sourceId: m.sourceId, ref: refOf(m), party: partyOf(m), status: statusOf(m), createdAt: m.createdAt })),
      };
    });
  }

  private async refs(tx: Tx, ctx: RequestContext, input: Partial<ItemInput>) {
    const b = ctx.businessId!, u = ctx.userId;
    return {
      ...(input.unit !== undefined && { unitId: await unitIdFor(tx, b, u, input.unit || 'PCS') }),
      ...(input.secondaryUnit !== undefined && { secondaryUnitId: await unitIdFor(tx, b, u, input.secondaryUnit) }),
      ...(input.category !== undefined && { categoryId: await namedId(tx, 'category', b, u, input.category) }),
      ...(input.brand !== undefined && { brandId: await namedId(tx, 'brand', b, u, input.brand) }),
      ...(input.group !== undefined && { itemGroupId: await namedId(tx, 'itemGroup', b, u, input.group) }),
    };
  }

  private fields(input: Partial<ItemInput>) {
    const m = (v: string | null | undefined) => toDb(v ?? 0);
    const q = (v: string | null | undefined) => money(v ?? 0).toDecimalPlaces(3).toFixed(3);
    return {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.code !== undefined && { code: input.code }),
      ...(input.hsn !== undefined && { hsn: input.hsn }),
      ...(input.series !== undefined && { series: input.series }),
      ...(input.gstRate !== undefined && { gstRate: money(input.gstRate).toFixed(2) }),
      ...(input.sale !== undefined && { salePrice: m(input.sale) }),
      ...(input.purchase !== undefined && { purchasePrice: m(input.purchase) }),
      ...(input.mrp !== undefined && { mrp: m(input.mrp) }),
      ...(input.listPrice !== undefined && { listPrice: m(input.listPrice) }),
      ...(input.wholesale !== undefined && { wholesalePrice: m(input.wholesale) }),
      ...(input.wholesaleMinQty !== undefined && { wholesaleMinQty: q(input.wholesaleMinQty) }),
      ...(input.minStock !== undefined && { minStock: q(input.minStock) }),
      ...(input.location !== undefined && { location: input.location }),
      ...(input.description !== undefined && { description: input.description }),
      // the rate belongs to the secondary unit: no secondary unit, no rate
      ...(input.secondaryUnit !== undefined && { unitRate: input.secondaryUnit && input.unitRate ? q(input.unitRate) : null }),
    };
  }

  /** Clear messages before the database's own unique indexes (which stay as the guard against two saves at once). */
  private async clash(tx: Tx, input: Partial<ItemInput>, exceptId?: string) {
    const not = exceptId ? { id: { not: exceptId } } : {};
    if (input.secondaryUnit) {
      if (input.unit !== undefined && input.secondaryUnit === (input.unit || 'PCS')) throw new BadRequestException({ message: 'The secondary unit must be different from the base unit.', field: 'unit' });
      if (!(input.unitRate && money(input.unitRate).gt(0))) throw new BadRequestException({ message: 'Enter how many secondary units make 1 base unit.', field: 'unit' });
    }
    if (input.code && (await tx.item.findFirst({ where: { archivedAt: null, code: { equals: input.code, mode: 'insensitive' }, ...not } })))
      throw new ConflictException({ message: 'This item code is already used.', field: 'code' });
    // A variant's series is new within its parent item and brand (ignoring capital letters).
    if (input.group && input.brand) {
      const series = (input.series ?? '').trim();
      const same = { equals: series, mode: 'insensitive' as const };
      if (await tx.item.findFirst({ where: { archivedAt: null, itemGroup: { name: { equals: input.group, mode: 'insensitive' } }, brand: { name: { equals: input.brand, mode: 'insensitive' } }, series: same, ...not } }))
        throw new ConflictException({ message: `${input.brand}${series ? ' ' + series : ''} is already in this item. Enter a different series.`, field: 'series' });
    }
    if (input.name && (await tx.item.findFirst({ where: { archivedAt: null, name: { equals: input.name, mode: 'insensitive' }, ...not } })))
      throw new ConflictException({ message: 'An item with this name already exists.', field: 'name' });
  }

  /**
   * The next own code: the shop's prefix (Settings › Items, default JE) + the lowest free number, 3 to 5 digits
   * (JE001 … JE99999). Codes of all items count, archived ones too, so a code is never reused.
   */
  nextCode(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const s = await tx.businessSettings.findUnique({ where: { businessId: ctx.businessId! }, select: { data: true } });
      const p = (s?.data as Record<string, unknown> | null)?.itemPrefix;
      const prefix = typeof p === 'string' && ITEM_PREFIX.test(p) ? p : ITEM_PREFIX_DEFAULT;
      const re = new RegExp(`^${prefix}(\\d{3,5})$`, 'i');
      const rows = await tx.item.findMany({ where: { code: { startsWith: prefix, mode: 'insensitive' } }, select: { code: true } });
      const used = new Set(rows.flatMap((r) => { const m = re.exec(r.code); return m ? [Number(m[1])] : []; }));
      const taken = new Set(rows.map((r) => r.code.toLowerCase()));
      for (let n = 1; n <= 99999; n++) {
        const code = prefix + String(n).padStart(3, '0');
        if (!used.has(n) && !taken.has(code.toLowerCase())) return { code };
      }
      throw new ConflictException({ message: `All item codes from ${prefix}001 to ${prefix}99999 are used.`, field: 'code' });
    });
  }

  private conflict(e: unknown): never {
    const m = uniqueMessage(e);
    if (m) throw new ConflictException({ message: m, field: /code/.test(m) ? 'code' : 'name' });
    throw e;
  }

  async create(ctx: RequestContext, input: ItemInput) {
    if (input.kind === 'service' && input.openingQty && money(input.openingQty).gt(0)) throw new BadRequestException({ message: 'A service has no stock.' });
    // the purchase price is automatic (owner's rule, Oct 2026): a new item's is its opening stock's rate
    const opening = input.kind === 'goods' && input.openingQty && money(input.openingQty).gt(0) ? { rate: toDb(input.openingRate ?? input.purchase ?? 0) } : null;
    try {
      return await this.db.scoped(this.scope(ctx), async (tx) => {
        await this.clash(tx, input);
        const it = await tx.item.create({
          data: { businessId: ctx.businessId!, createdBy: ctx.userId, ...this.fields(input), name: input.name, kind: input.kind, ...(await this.refs(tx, ctx, { ...input, unit: input.unit || 'PCS' })), ...(opening && money(opening.rate).gt(0) && { purchasePrice: opening.rate }) },
        });
        if (opening) {
          const g = await tx.godown.findFirstOrThrow({ where: { isDefault: true, archivedAt: null } });
          await tx.stockMovement.create({
            data: {
              businessId: ctx.businessId!, createdBy: ctx.userId, itemId: it.id, godownId: g.id, date: day(input.openingDate ?? todayIst()),
              qty: money(input.openingQty!).toDecimalPlaces(3).toFixed(3), rate: opening.rate, kind: 'opening', note: 'Opening stock',
            },
          });
        }
        const v = await this.view(tx, it.id);
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'item', entityId: it.id, after: v, ip: ctx.ip });
        return v;
      });
    } catch (e) {
      this.conflict(e);
    }
  }

  /**
   * Changes one item inside the caller's transaction: the same checks, price history and audit entry
   * for editing one item and for Bulk update items. The audit entry keeps each changed field (old and
   * new value) in after.changes, as the edits of saved records do.
   */
  private async edit(tx: Tx, ctx: RequestContext, id: string, input: Partial<ItemInput>, how: string) {
    if ((await this.find(tx, id)).deletedAt) throw new BadRequestException({ message: ALREADY_DELETED });
    const before = await this.view(tx, id);
    await this.clash(tx, input, id);
    if (input.kind === 'service' && before.kind === 'goods' && before.stock && !money(before.stock).isZero())
      throw new BadRequestException({ message: 'This item has stock. Bring its stock to zero before making it a service.' });
    await tx.item.update({ where: { id }, data: { ...this.fields(input), ...(await this.refs(tx, ctx, input)) } });
    const after = await this.view(tx, id);
    for (const [f, field] of [['sale', 'sale'], ['purchase', 'purchase'], ['mrp', 'mrp'], ['listPrice', 'list'], ['wholesale', 'wholesale']] as const) {
      if (before[f] !== after[f])
        await tx.priceHistory.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: id, field, oldValue: before[f], newValue: after[f], how } });
    }
    const changes = fieldChanges(before, after, ITEM_AUDIT_FIELDS);
    await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'item', entityId: id, before, after: { ...after, changes }, ip: ctx.ip });
    return after;
  }

  async update(ctx: RequestContext, id: string, input: Partial<ItemInput>) {
    try {
      return await this.db.scoped(this.scope(ctx), (tx) => this.edit(tx, ctx, id, input, 'Edited item'));
    } catch (e) {
      this.conflict(e);
    }
  }

  /**
   * Bulk update items: every changed row with the single item edit's rules, all in one transaction.
   * If one row can't be saved nothing is saved, and the message names the item and the reason.
   */
  async bulkUpdate(ctx: RequestContext, input: BulkItemsInput): Promise<BulkItemsResult> {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      // every id must be one of this shop's items (row-level security hides other shops' items)
      const found = await tx.item.findMany({ where: { id: { in: input.rows.map((r) => r.id) } }, select: { id: true, name: true } });
      const names = new Map(found.map((i) => [i.id, i.name]));
      const missing = input.rows.filter((r) => !names.has(r.id)).length;
      if (missing) throw new NotFoundException({ message: `${missing === 1 ? 'One item was' : `${missing} items were`} not found. Nothing was saved. Reload the page and try again.` });
      for (const { id, ...change } of input.rows) {
        try {
          await this.edit(tx, ctx, id, change, 'Bulk update');
        } catch (e) {
          throw this.rowError(e, id, names.get(id)!);
        }
      }
      return { updated: input.rows.length };
    }, { timeout: 120_000 });
  }

  /** A row's problem as "<item name>: <reason>. Nothing was saved.", with the item and field it is about. */
  private rowError(e: unknown, itemId: string, name: string, tail = 'Nothing was saved.'): unknown {
    const m = uniqueMessage(e);
    const err = m ? new ConflictException({ message: m, field: /code/.test(m) ? 'code' : 'name' }) : e;
    if (!(err instanceof HttpException)) return err;
    const body = err.getResponse() as { message?: string; field?: string } | string;
    const reason = typeof body === 'string' ? body : body.message ?? 'This item could not be saved.';
    const field = typeof body === 'string' ? undefined : body.field;
    return new HttpException({ message: `${name}: ${reason} ${tail}`, itemId, field }, err.getStatus());
  }

  setArchived(ctx: RequestContext, id: string, archived: boolean) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const i = await this.find(tx, id);
      if (i.deletedAt) throw new BadRequestException({ message: ALREADY_DELETED });
      if (archived === !!i.archivedAt) return this.view(tx, id);
      await this.archiveOne(tx, ctx, id, archived);
      return this.view(tx, id);
    });
  }

  /** Makes one item inactive (or active again) inside the caller's transaction, with its audit entry. */
  private async archiveOne(tx: Tx, ctx: RequestContext, id: string, archived: boolean) {
    try {
      await tx.item.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    } catch (e) {
      if (uniqueMessage(e)) throw new ConflictException({ message: 'An item with this name or code already exists. Rename one of them first.' });
      throw e;
    }
    await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: archived ? 'cancel' : 'update', entity: 'item', entityId: id, before: { archived: !archived }, after: { archived }, ip: ctx.ip });
  }

  /**
   * Bulk active / inactive: the ticked items, all in one transaction. Items already in that state are
   * skipped (no change, no audit entry). If one can't be changed (Make active: an active item has its
   * name or code) nothing is changed, and the message names the item.
   */
  bulkSetActive(ctx: RequestContext, input: BulkActiveInput): Promise<BulkActiveResult> {
    const archived = !input.active;
    return this.db.scoped(this.scope(ctx), async (tx) => {
      // every id must be one of this shop's items (row-level security hides other shops' items)
      const found = await tx.item.findMany({ where: { id: { in: input.ids }, deletedAt: null }, select: { id: true, name: true, archivedAt: true } });
      const missing = input.ids.length - found.length;
      if (missing) throw new NotFoundException({ message: `${missing === 1 ? 'One item was' : `${missing} items were`} not found. Nothing was changed. Reload the page and try again.` });
      const todo = found.filter((i) => archived !== !!i.archivedAt);
      for (const i of todo) {
        try {
          await this.archiveOne(tx, ctx, i.id, archived);
        } catch (e) {
          throw this.rowError(e, i.id, i.name, 'Nothing was changed.');
        }
      }
      return { changed: todo.length, skipped: found.length - todo.length };
    }, { timeout: 120_000 });
  }

  /**
   * What uses an item, e.g. ["3 sale invoices", "1 purchase bill"]; empty when it can be deleted. Every
   * document counts (cancelled and deleted ones too: they still show it); its opening stock doesn't.
   */
  private async uses(tx: Tx, id: string) {
    const [sales, purchases, adjustments, transfers, other] = await Promise.all([
      tx.salesDocument.findMany({ where: { lines: { some: { itemId: id } } }, select: { kind: true } }),
      tx.purchaseDocument.findMany({ where: { lines: { some: { itemId: id } } }, select: { kind: true } }),
      tx.stockAdjustment.count({ where: { itemId: id } }),
      tx.stockTransfer.count({ where: { itemId: id } }),
      // anything else in its stock ledger (e.g. an imported sale without its bill)
      tx.stockMovement.count({ where: { itemId: id, kind: { not: 'opening' }, sourceType: { notIn: ['sales_document', 'purchase_document', 'stock_adjustment', 'stock_transfer', 'item'] } } }),
    ]);
    const n = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;
    return [
      ...count(n(sales, 'invoice'), 'sale invoice'), ...count(n(sales, 'quotation'), 'quotation'), ...count(n(sales, 'challan'), 'delivery challan'), ...count(n(sales, 'credit_note'), 'credit note'),
      ...count(n(purchases, 'bill'), 'purchase bill'), ...count(n(purchases, 'order'), 'purchase order'), ...count(n(purchases, 'debit_note'), 'debit note'),
      ...count(adjustments, 'stock adjustment'), ...count(transfers, 'stock transfer'), ...count(other, 'stock entry', 'stock entries'),
    ];
  }

  /** Whether Delete can go ahead, and if not the message for the "can't delete" box (Edit item › Delete). */
  usage(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const i = await this.find(tx, id);
      const uses = await this.uses(tx, id);
      return { canDelete: !uses.length, message: uses.length ? usedMessage(i.name, uses, 'lists and new bills') : '' };
    });
  }

  /**
   * Delete an item that was never used (common/deleting.ts): its opening stock is put back, then it is
   * made inactive and marked deleted. The row stays; nothing else changes.
   */
  delete(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const i = await this.find(tx, id);
      if (i.deletedAt) throw new BadRequestException({ message: ALREADY_DELETED });
      const uses = await this.uses(tx, id);
      if (uses.length) throw new BadRequestException({ message: usedMessage(i.name, uses, 'lists and new bills') });
      const before = await this.view(tx, id);
      const left = await tx.stockMovement.groupBy({ by: ['godownId'], where: { itemId: id }, _sum: { qty: true } });
      const back = left.filter((g) => g._sum.qty && !g._sum.qty.isZero());
      if (back.length)
        await tx.stockMovement.createMany({
          data: back.map((g) => ({ businessId: ctx.businessId!, createdBy: ctx.userId, itemId: id, godownId: g.godownId, date: day(todayIst()), qty: g._sum.qty!.neg().toFixed(3), kind: 'cancel', sourceType: 'item', note: 'Item deleted' })),
        });
      const at = new Date();
      await tx.item.update({ where: { id }, data: { archivedAt: i.archivedAt ?? at, deletedAt: at, deletedBy: ctx.userId } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'delete', entity: 'item', entityId: id, before, after: { deleted: true, openingStockPutBack: back.map((g) => ({ godownId: g.godownId, qty: q3(g._sum.qty!) })) }, ip: ctx.ip });
      return { id, name: i.name };
    });
  }

  /** Units, categories and brands for pickers, with how many live items use each. */
  lists(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const live = { where: { archivedAt: null } };
      const [units, categories, brands, groups] = await Promise.all([
        tx.unit.findMany({ where: { archivedAt: null }, include: { _count: { select: { items: live } } }, orderBy: { createdAt: 'asc' } }),
        tx.category.findMany({ where: { archivedAt: null }, include: { _count: { select: { items: live } } }, orderBy: { createdAt: 'asc' } }),
        tx.brand.findMany({ where: { archivedAt: null }, include: { _count: { select: { items: live } } }, orderBy: { name: 'asc' } }),
        tx.itemGroup.findMany({ where: { archivedAt: null }, include: { _count: { select: { items: live } } }, orderBy: { name: 'asc' } }),
      ]);
      // conversion rates already used on items, offered again in the Select unit window
      const conv = await tx.item.findMany({ where: { archivedAt: null, secondaryUnitId: { not: null }, unitRate: { not: null } }, select: { unit: { select: { code: true } }, secondaryUnit: { select: { code: true } }, unitRate: true } });
      const rates = [...new Map(conv.filter((c) => c.unit && c.secondaryUnit).map((c) => {
        const r = { unit: c.unit!.code, secondaryUnit: c.secondaryUnit!.code, rate: q3(c.unitRate!) };
        return [`${r.unit}|${r.secondaryUnit}|${r.rate}`, r] as const;
      })).values()];
      return {
        units: units.map((u) => ({ id: u.id, code: u.code, name: u.name, items: u._count.items })),
        rates,
        categories: categories.map((c) => ({ id: c.id, name: c.name, items: c._count.items })),
        brands: brands.map((b) => ({ id: b.id, name: b.name, items: b._count.items })),
        groups: groups.map((g) => ({ id: g.id, name: g.name, items: g._count.items })),
      };
    });
  }

  addNamed(ctx: RequestContext, kind: 'category' | 'brand', name: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const id = await namedId(tx, kind, ctx.businessId!, ctx.userId, name);
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: kind, entityId: id, after: { name }, ip: ctx.ip });
      return { id, name };
    });
  }

  addUnit(ctx: RequestContext, code: string, name = '') {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const id = await unitIdFor(tx, ctx.businessId!, ctx.userId, code, name);
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'unit', entityId: id, after: { code, name }, ip: ctx.ip });
      return { id, code, name };
    });
  }
}
