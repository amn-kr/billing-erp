import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { listPrice, money, toDb, type PriceChangesInput, type PriceListInput, type PriceRule } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { namedId, uniqueMessage } from '../../common/lookups';

const FIELD_COLUMN = { sale: 'salePrice', purchase: 'purchasePrice', mrp: 'mrp', listPrice: 'listPrice', wholesale: 'wholesalePrice' } as const;
const FIELD_HISTORY = { sale: 'sale', purchase: 'purchase', mrp: 'mrp', listPrice: 'list', wholesale: 'wholesale' } as const;

@Injectable()
export class PricingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  private async lists(tx: Tx) {
    const rows = await tx.priceList.findMany({ where: { archivedAt: null }, include: { rules: { include: { partyGroup: true } }, _count: { select: { prices: true } } }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    return rows.map((p) => ({
      id: p.id, name: p.name, isDefault: p.isDefault, rule: p.rule as PriceRule, value: money(p.value.toString()).toString(), roundTo: money(p.roundTo.toString()).toString(),
      active: p.active, groups: p.rules.map((r) => r.partyGroup.name), fixedPrices: p._count.prices,
    }));
  }

  priceLists(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), (tx) => this.lists(tx));
  }

  /** Every live item's price in each active list (Price manager table). */
  prices(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const lists = (await this.lists(tx)).filter((l) => l.active);
      const items = await tx.item.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, salePrice: true, purchasePrice: true, mrp: true, listPrice: true } });
      const fixed = await tx.itemPrice.findMany();
      const fx = new Map(fixed.map((f) => [`${f.priceListId}:${f.itemId}`, f.price.toString()]));
      return {
        lists: lists.map((l) => ({ id: l.id, name: l.name })),
        items: items.map((i) => ({
          id: i.id, name: i.name, sale: toDb(i.salePrice.toString()), purchase: toDb(i.purchasePrice.toString()), mrp: toDb(i.mrp.toString()), listPrice: toDb(i.listPrice.toString()),
          lists: Object.fromEntries(lists.map((l) => {
            const f = fx.get(`${l.id}:${i.id}`);
            return [l.id, { price: toDb(listPrice(l.rule, l.value, l.roundTo, { sale: i.salePrice.toString(), purchase: i.purchasePrice.toString() }, f)), fixed: f !== undefined }];
          })),
        })),
      };
    });
  }

  private async setGroups(tx: Tx, ctx: RequestContext, priceListId: string, groups: string[]) {
    await tx.priceListRule.deleteMany({ where: { priceListId } });
    for (const g of groups) {
      const partyGroupId = (await namedId(tx, 'partyGroup', ctx.businessId!, ctx.userId, g))!;
      await tx.priceListRule.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, priceListId, partyGroupId } });
    }
  }

  async createList(ctx: RequestContext, input: PriceListInput) {
    try {
      return await this.db.scoped(this.scope(ctx), async (tx) => {
        const pl = await tx.priceList.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, name: input.name, rule: input.rule, value: String(input.value), roundTo: String(input.roundTo) } });
        await this.setGroups(tx, ctx, pl.id, input.groups);
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'price_list', entityId: pl.id, after: input, ip: ctx.ip });
        return (await this.lists(tx)).find((l) => l.id === pl.id)!;
      });
    } catch (e) {
      if (uniqueMessage(e)) throw new ConflictException({ message: 'A price list with this name already exists.', field: 'name' });
      throw e;
    }
  }

  updateList(ctx: RequestContext, id: string, input: Partial<PriceListInput> & { active?: boolean }) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const before = await tx.priceList.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundException({ message: 'That price list was not found.' });
      if (before.isDefault && (input.rule || input.active === false)) throw new BadRequestException({ message: 'The default price list is always the item’s sale price and can’t be switched off.' });
      await tx.priceList.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }), ...(input.rule !== undefined && { rule: input.rule }),
          ...(input.value !== undefined && { value: String(input.value) }), ...(input.roundTo !== undefined && { roundTo: String(input.roundTo) }),
          ...(input.active !== undefined && { active: input.active }),
        },
      });
      if (input.groups) await this.setGroups(tx, ctx, id, input.groups);
      const after = (await this.lists(tx)).find((l) => l.id === id)!;
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'price_list', entityId: id, before, after, ip: ctx.ip });
      return after;
    });
  }

  /** Fix one item's price in a list (or pass null to go back to the list's rule). */
  setFixed(ctx: RequestContext, priceListId: string, itemId: string, price: number | null) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const [pl, item] = await Promise.all([tx.priceList.findFirst({ where: { id: priceListId } }), tx.item.findFirst({ where: { id: itemId } })]);
      if (!pl || !item) throw new NotFoundException({ message: 'That price list or item was not found.' });
      const old = await tx.itemPrice.findUnique({ where: { priceListId_itemId: { priceListId, itemId } } });
      if (price === null) await tx.itemPrice.deleteMany({ where: { priceListId, itemId } });
      else await tx.itemPrice.upsert({ where: { priceListId_itemId: { priceListId, itemId } }, create: { businessId: ctx.businessId!, createdBy: ctx.userId, priceListId, itemId, price: toDb(price) }, update: { price: toDb(price) } });
      await tx.priceHistory.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId, field: `pl:${priceListId}`, oldValue: old?.price ?? null, newValue: price === null ? null : toDb(price), how: price === null ? 'Back to the list’s rule' : 'Fixed price' } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'item_price', entityId: itemId, before: old, after: { priceListId, price }, ip: ctx.ip });
    });
  }

  /** Price manager › bulk update: apply the previewed changes, each one recorded in price history. */
  applyChanges(ctx: RequestContext, input: PriceChangesInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const ids = [...new Set(input.changes.map((c) => c.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: ids } } });
      if (items.length !== ids.length) throw new NotFoundException({ message: 'Some of these items were not found.' });
      let changed = 0;
      for (const c of input.changes) {
        const it = items.find((i) => i.id === c.itemId)!;
        const col = FIELD_COLUMN[c.field];
        const old = toDb(it[col].toString());
        const nv = toDb(c.value);
        if (old === nv) continue;
        await tx.item.update({ where: { id: it.id }, data: { [col]: nv } });
        await tx.priceHistory.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: it.id, field: FIELD_HISTORY[c.field], oldValue: old, newValue: nv, how: input.how } });
        changed++;
      }
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'prices', after: { how: input.how, changed }, ip: ctx.ip });
      return { changed };
    });
  }

  history(ctx: RequestContext, itemId?: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const rows = await tx.priceHistory.findMany({ where: itemId ? { itemId } : {}, include: { item: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } }, select: { id: true, name: true } });
      return rows.map((r) => ({
        at: r.createdAt, itemId: r.itemId, item: r.item.name, field: r.field, oldValue: r.oldValue ? toDb(r.oldValue.toString()) : null,
        newValue: r.newValue ? toDb(r.newValue.toString()) : null, how: r.how, by: users.find((u) => u.id === r.createdBy)?.name ?? '',
      }));
    });
  }
}
