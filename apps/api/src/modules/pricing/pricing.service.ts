import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { listPrice, money, toDb, type PriceChangesInput, type PriceListInput, type PriceRule, type PriceRuleSaveInput } from '@billing/shared';
import { Prisma } from '@prisma/client';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { namedId, uniqueMessage } from '../../common/lookups';

const FIELD_COLUMN = { sale: 'salePrice', purchase: 'purchasePrice', mrp: 'mrp', listPrice: 'listPrice', wholesale: 'wholesalePrice' } as const;
const FIELD_HISTORY = { sale: 'sale', purchase: 'purchase', mrp: 'mrp', listPrice: 'list', wholesale: 'wholesale' } as const;
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
/** Same limits as the prototype: 5 wrong tries, then wait 60 seconds. */
const PIN_TRIES = 5;
const PIN_WAIT_MS = 60_000;

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
      // same order as the Items screen and the prototype's Price manager: newest first
      const items = await tx.item.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, salePrice: true, purchasePrice: true, mrp: true, listPrice: true } });
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

  async createList(ctx: RequestContext, input: PriceListInput, pin: string) {
    await this.checkPin(ctx, pin);
    try {
      return await this.db.scoped(this.scope(ctx), async (tx) => {
        const pl = await tx.priceList.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, name: input.name.trim(), rule: input.rule, value: String(input.value), roundTo: String(input.roundTo) } });
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

  /* ───────── price PIN ───────── */

  pinState(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => ({ set: !!(await tx.priceLock.findUnique({ where: { businessId: ctx.businessId! } })) }));
  }

  /**
   * Checks the PIN. Wrong tries are counted in their own transaction (so the
   * count survives the error) and five in a row lock the PIN for 60 seconds.
   */
  async checkPin(ctx: RequestContext, pin: string): Promise<void> {
    const problem = await this.db.scoped(this.scope(ctx), async (tx) => {
      const l = await tx.priceLock.findUnique({ where: { businessId: ctx.businessId! } });
      if (!l) return 'Set a price PIN first.';
      const now = Date.now();
      if (l.waitUntil && l.waitUntil.getTime() > now) return `Too many wrong tries. Try again in ${Math.ceil((l.waitUntil.getTime() - now) / 1000)} seconds.`;
      if (await verify(l.pinHash, pin)) {
        if (l.fails || l.waitUntil) await tx.priceLock.update({ where: { businessId: l.businessId }, data: { fails: 0, waitUntil: null } });
        return null;
      }
      const fails = l.fails + 1;
      if (fails >= PIN_TRIES) {
        await tx.priceLock.update({ where: { businessId: l.businessId }, data: { fails: 0, waitUntil: new Date(now + PIN_WAIT_MS) } });
        return 'Too many wrong tries. Try again in 60 seconds.';
      }
      await tx.priceLock.update({ where: { businessId: l.businessId }, data: { fails } });
      const left = PIN_TRIES - fails;
      return `Wrong PIN. ${left} tr${left > 1 ? 'ies' : 'y'} left.`;
    });
    if (problem) throw new BadRequestException({ message: problem, field: 'pin' });
  }

  /** Set the first PIN, or change it (the current PIN is needed once one is set). */
  async setPin(ctx: RequestContext, pin: string, currentPin?: string) {
    const exists = (await this.pinState(ctx)).set;
    if (exists) {
      if (!currentPin) throw new BadRequestException({ message: 'Enter your current PIN.', field: 'currentPin' });
      await this.checkPin(ctx, currentPin);
    }
    const pinHash = await hash(pin, ARGON);
    await this.db.scoped(this.scope(ctx), async (tx) => {
      await tx.priceLock.upsert({ where: { businessId: ctx.businessId! }, create: { businessId: ctx.businessId!, createdBy: ctx.userId, pinHash }, update: { pinHash, fails: 0, waitUntil: null } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: exists ? 'update' : 'create', entity: 'price_pin', ip: ctx.ip });
    });
  }

  /** Save (or with null remove) one brand / series rule, kept in the shop settings as the prototype's erp-prules. */
  async saveRule(ctx: RequestContext, input: PriceRuleSaveInput) {
    await this.checkPin(ctx, input.pin);
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const s = await tx.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId! } });
      const data = (s.data ?? {}) as Record<string, unknown>;
      const rules = { ...((data.priceRules ?? {}) as Record<string, unknown>) };
      const before = rules[input.key] ?? null;
      if (input.rule) rules[input.key] = input.rule;
      else delete rules[input.key];
      await tx.businessSettings.update({ where: { businessId: ctx.businessId! }, data: { data: { ...data, priceRules: rules } as Prisma.InputJsonValue } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: input.rule ? 'update' : 'cancel', entity: 'price_rule', before: { key: input.key, rule: before }, after: { key: input.key, rule: input.rule }, ip: ctx.ip });
      return { rules };
    });
  }

  /** Fix one item's price in a list (or pass null to go back to the list's rule). */
  async setFixed(ctx: RequestContext, priceListId: string, itemId: string, price: number | null, pin: string) {
    await this.checkPin(ctx, pin);
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

  /**
   * Price manager › Price Setup / Excel import / Undo: apply the previewed changes,
   * each one recorded in price history. `pl:<id>` fields set (or, with null,
   * clear) an item's own price in that list. Needs the price PIN.
   */
  async applyChanges(ctx: RequestContext, input: PriceChangesInput) {
    await this.checkPin(ctx, input.pin);
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const ids = [...new Set(input.changes.map((c) => c.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: ids } } });
      if (items.length !== ids.length) throw new NotFoundException({ message: 'Some of these items were not found.' });
      const lists = await tx.priceList.findMany({ where: { archivedAt: null } });
      let changed = 0;
      for (const c of input.changes) {
        const it = items.find((i) => i.id === c.itemId)!;
        if (c.field.startsWith('pl:')) {
          const pl = lists.find((l) => l.id === c.field.slice(3));
          if (!pl || pl.isDefault) throw new BadRequestException({ message: 'That price list was not found.' });
          const own = await tx.itemPrice.findUnique({ where: { priceListId_itemId: { priceListId: pl.id, itemId: it.id } } });
          const old = toDb(listPrice(pl.rule as PriceRule, pl.value.toString(), pl.roundTo.toString(), { sale: it.salePrice.toString(), purchase: it.purchasePrice.toString() }, own?.price.toString()));
          if (c.value === null) {
            if (!own) continue;
            await tx.itemPrice.deleteMany({ where: { priceListId: pl.id, itemId: it.id } });
          } else {
            if (own && toDb(own.price.toString()) === toDb(c.value)) continue;
            await tx.itemPrice.upsert({ where: { priceListId_itemId: { priceListId: pl.id, itemId: it.id } }, create: { businessId: ctx.businessId!, createdBy: ctx.userId, priceListId: pl.id, itemId: it.id, price: toDb(c.value) }, update: { price: toDb(c.value) } });
          }
          await tx.priceHistory.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: it.id, field: c.field, oldValue: old, newValue: c.value === null ? null : toDb(c.value), how: input.how } });
          changed++;
          continue;
        }
        const f = c.field as keyof typeof FIELD_COLUMN;
        const col = FIELD_COLUMN[f];
        const old = toDb(it[col].toString());
        const nv = toDb(c.value!);
        if (old === nv) continue;
        await tx.item.update({ where: { id: it.id }, data: { [col]: nv } });
        (it as Record<string, unknown>)[col] = new Prisma.Decimal(nv);
        await tx.priceHistory.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: it.id, field: FIELD_HISTORY[f], oldValue: old, newValue: nv, how: input.how } });
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
