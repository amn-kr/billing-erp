import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { money, todayIst, toDb, type ItemInput } from '@billing/shared';
import type { Prisma } from '@prisma/client';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf, namedId, unitIdFor, uniqueMessage } from '../../common/lookups';

const include = { unit: true, category: true, brand: true, itemGroup: true } satisfies Prisma.ItemInclude;
type Row = Prisma.ItemGetPayload<{ include: typeof include }>;
const q3 = (v: Prisma.Decimal | string | number) => money(v.toString()).toDecimalPlaces(3).toFixed(3);

export function itemView(i: Row, stock: Prisma.Decimal | string | null) {
  const st = i.kind === 'service' ? null : q3(stock ?? '0');
  const min = money(i.minStock.toString());
  return {
    id: i.id, kind: i.kind, name: i.name, code: i.code, hsn: i.hsn, unit: i.unit?.code ?? '', category: i.category?.name ?? '',
    brand: i.brand?.name ?? '', group: i.itemGroup?.name ?? '', series: i.series, gstRate: money(i.gstRate.toString()).toFixed(2),
    sale: toDb(i.salePrice.toString()), purchase: toDb(i.purchasePrice.toString()), mrp: toDb(i.mrp.toString()), listPrice: toDb(i.listPrice.toString()),
    wholesale: toDb(i.wholesalePrice.toString()), wholesaleMinQty: q3(i.wholesaleMinQty), minStock: q3(i.minStock), location: i.location,
    stock: st,
    /** ok | low (at or below minimum) | out (none left) — prototype lvl() */
    level: st === null ? 'ok' : money(st).lte(0) ? 'out' : min.gt(0) && money(st).lt(min) ? 'low' : 'ok',
    archived: !!i.archivedAt, createdAt: i.createdAt,
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

  list(ctx: RequestContext, q: { search?: string; kind?: string; category?: string; brand?: string; level?: string; archived?: boolean }) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const s = q.search?.trim();
      const rows = await tx.item.findMany({
        where: {
          archivedAt: q.archived ? { not: null } : null,
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
      const out = rows.map((i) => itemView(i, stock.get(i.id) ?? null));
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
      const refOf = (m: (typeof movements)[number]) => (m.sourceId ? adjs.get(m.sourceId)?.number ?? trfs.get(m.sourceId)?.number ?? '' : '');
      return {
        ...item,
        godowns: godowns.map((g) => ({ id: g.id, name: g.name, stock: q3(byGodown.find((b) => b.godownId === g.id)?._sum.qty ?? '0') })),
        movements: movements.map((m) => ({ id: m.id, date: isoOf(m.date), kind: m.kind, qty: q3(m.qty), rate: toDb(m.rate.toString()), godown: m.godown.name, note: m.note, sourceType: m.sourceType, sourceId: m.sourceId, ref: refOf(m), createdAt: m.createdAt })),
      };
    });
  }

  private async refs(tx: Tx, ctx: RequestContext, input: Partial<ItemInput>) {
    const b = ctx.businessId!, u = ctx.userId;
    return {
      ...(input.unit !== undefined && { unitId: await unitIdFor(tx, b, u, input.unit || 'PCS') }),
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
    };
  }

  /** Clear messages before the database's own unique indexes (which stay as the guard against two saves at once). */
  private async clash(tx: Tx, input: Partial<ItemInput>, exceptId?: string) {
    const not = exceptId ? { id: { not: exceptId } } : {};
    if (input.code && (await tx.item.findFirst({ where: { archivedAt: null, code: { equals: input.code, mode: 'insensitive' }, ...not } })))
      throw new ConflictException({ message: 'This item code is already used.', field: 'code' });
    if (input.name && (await tx.item.findFirst({ where: { archivedAt: null, name: { equals: input.name, mode: 'insensitive' }, ...not } })))
      throw new ConflictException({ message: 'An item with this name already exists.', field: 'name' });
  }

  private conflict(e: unknown): never {
    const m = uniqueMessage(e);
    if (m) throw new ConflictException({ message: m, field: /code/.test(m) ? 'code' : 'name' });
    throw e;
  }

  async create(ctx: RequestContext, input: ItemInput) {
    if (input.kind === 'service' && input.openingQty && money(input.openingQty).gt(0)) throw new BadRequestException({ message: 'A service has no stock.' });
    try {
      return await this.db.scoped(this.scope(ctx), async (tx) => {
        await this.clash(tx, input);
        const it = await tx.item.create({
          data: { businessId: ctx.businessId!, createdBy: ctx.userId, ...this.fields(input), name: input.name, kind: input.kind, ...(await this.refs(tx, ctx, { ...input, unit: input.unit || 'PCS' })) },
        });
        if (input.kind === 'goods' && input.openingQty && money(input.openingQty).gt(0)) {
          const g = await tx.godown.findFirstOrThrow({ where: { isDefault: true, archivedAt: null } });
          await tx.stockMovement.create({
            data: {
              businessId: ctx.businessId!, createdBy: ctx.userId, itemId: it.id, godownId: g.id, date: day(input.openingDate ?? todayIst()),
              qty: money(input.openingQty).toDecimalPlaces(3).toFixed(3), rate: toDb(input.openingRate ?? input.purchase ?? 0), kind: 'opening', note: 'Opening stock',
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

  async update(ctx: RequestContext, id: string, input: Partial<ItemInput>) {
    try {
      return await this.db.scoped(this.scope(ctx), async (tx) => {
        const before = await this.view(tx, id);
        await this.clash(tx, input, id);
        if (input.kind === 'service' && before.kind === 'goods' && before.stock && !money(before.stock).isZero())
          throw new BadRequestException({ message: 'This item has stock. Bring its stock to zero before making it a service.' });
        await tx.item.update({ where: { id }, data: { ...this.fields(input), ...(await this.refs(tx, ctx, input)) } });
        const after = await this.view(tx, id);
        for (const [f, field] of [['sale', 'sale'], ['purchase', 'purchase'], ['mrp', 'mrp'], ['listPrice', 'list'], ['wholesale', 'wholesale']] as const) {
          if (before[f] !== after[f])
            await tx.priceHistory.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: id, field, oldValue: before[f], newValue: after[f], how: 'Edited item' } });
        }
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'item', entityId: id, before, after, ip: ctx.ip });
        return after;
      });
    } catch (e) {
      this.conflict(e);
    }
  }

  setArchived(ctx: RequestContext, id: string, archived: boolean) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const i = await this.find(tx, id);
      if (archived === !!i.archivedAt) return this.view(tx, id);
      try {
        await tx.item.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
      } catch (e) {
        if (uniqueMessage(e)) throw new ConflictException({ message: 'An item with this name or code already exists. Rename one of them first.' });
        throw e;
      }
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: archived ? 'cancel' : 'update', entity: 'item', entityId: id, before: { archived: !archived }, after: { archived }, ip: ctx.ip });
      return this.view(tx, id);
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
      return {
        units: units.map((u) => ({ id: u.id, code: u.code, items: u._count.items })),
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

  addUnit(ctx: RequestContext, code: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const id = await unitIdFor(tx, ctx.businessId!, ctx.userId, code);
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'unit', entityId: id, after: { code }, ip: ctx.ip });
      return { id, code };
    });
  }
}
