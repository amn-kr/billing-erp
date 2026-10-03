import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { money, toDb, type GodownInput, type StockAdjustmentInput, type StockTransferInput } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf, uniqueMessage } from '../../common/lookups';

const q3 = (v: { toString(): string } | number | string) => money(v.toString()).toDecimalPlaces(3).toFixed(3);

/** Godowns, stock adjustments and transfers. Every change is a pair of rows in the stock ledger; cancelling adds the opposite rows. */
@Injectable()
export class StockService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /* ───────── godowns ───────── */

  godowns(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const gs = await tx.godown.findMany({ where: { archivedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      const sums = await tx.stockMovement.groupBy({ by: ['godownId', 'itemId'], _sum: { qty: true } });
      const items = await tx.item.findMany({ where: { kind: 'goods' }, select: { id: true, purchasePrice: true } });
      const price = new Map(items.map((i) => [i.id, money(i.purchasePrice.toString())]));
      return gs.map((g) => {
        const mine = sums.filter((s) => s.godownId === g.id && !money(s._sum.qty!.toString()).isZero());
        const value = mine.reduce((a, s) => a.plus(money(s._sum.qty!.toString()).times(price.get(s.itemId) ?? 0)), money(0));
        return { id: g.id, name: g.name, address: g.address, manager: g.manager, phone: g.phone, isDefault: g.isDefault, items: mine.length, value: toDb(value) };
      });
    });
  }

  /** Items with stock in one godown (Godowns screen table), largest value first. */
  godownItems(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const g = await tx.godown.findFirst({ where: { id, archivedAt: null } });
      if (!g) throw new NotFoundException({ message: 'That godown was not found.' });
      const here = await tx.stockMovement.groupBy({ by: ['itemId'], where: { godownId: id }, _sum: { qty: true } });
      const total = await tx.stockMovement.groupBy({ by: ['itemId'], _sum: { qty: true } });
      const items = await tx.item.findMany({ where: { id: { in: here.map((h) => h.itemId) }, kind: 'goods' }, include: { category: true, unit: true } });
      return here
        .map((h) => {
          const i = items.find((x) => x.id === h.itemId);
          const q = money(h._sum.qty!.toString());
          if (!i || q.isZero()) return null;
          return {
            itemId: i.id, name: i.name, category: i.category?.name ?? '', unit: i.unit?.code ?? '', inGodown: q3(q),
            total: q3(total.find((t) => t.itemId === i.id)?._sum.qty ?? 0), value: toDb(q.times(i.purchasePrice.toString())), valueN: q.times(i.purchasePrice.toString()).toNumber(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => !!r)
        .sort((a, b) => b.valueN - a.valueN)
        .map(({ valueN: _v, ...r }) => r);
    });
  }

  transfers(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const rows = await tx.stockTransfer.findMany({ where: { cancelledAt: null }, include: { item: { include: { unit: true } }, fromGodown: true, toGodown: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 50 });
      return rows.map((t) => ({ id: t.id, number: t.number, date: isoOf(t.date), item: t.item.name, unit: t.item.unit?.code ?? '', qty: q3(t.qty), from: t.fromGodown.name, to: t.toGodown.name }));
    });
  }

  async addGodown(ctx: RequestContext, input: GodownInput) {
    try {
      return await this.db.scoped(this.scope(ctx), async (tx) => {
        const g = await tx.godown.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, ...input } });
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'godown', entityId: g.id, after: g, ip: ctx.ip });
        return g;
      });
    } catch (e) {
      if (uniqueMessage(e)) throw new ConflictException({ message: 'A godown with this name already exists.', field: 'name' });
      throw e;
    }
  }

  async updateGodown(ctx: RequestContext, id: string, input: Partial<GodownInput> & { isDefault?: boolean }) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const before = await tx.godown.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundException({ message: 'That godown was not found.' });
      if (input.isDefault) await tx.godown.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const after = await tx.godown.update({ where: { id }, data: { ...input, ...(input.isDefault === false && before.isDefault ? { isDefault: true } : {}) } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'godown', entityId: id, before, after, ip: ctx.ip });
      return after;
    });
  }

  archiveGodown(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const g = await tx.godown.findFirst({ where: { id, archivedAt: null } });
      if (!g) throw new NotFoundException({ message: 'That godown was not found.' });
      if (g.isDefault) throw new BadRequestException({ message: 'This is your main godown. Make another godown the main one first.' });
      const left = await tx.stockMovement.groupBy({ by: ['itemId'], where: { godownId: id }, _sum: { qty: true } });
      if (left.some((s) => !money(s._sum.qty!.toString()).isZero())) throw new BadRequestException({ message: 'This godown still has stock. Transfer it to another godown first.' });
      await tx.godown.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'godown', entityId: id, before: g, ip: ctx.ip });
    });
  }

  /* ───────── adjustments ───────── */

  private async stockIn(tx: Tx, itemId: string, godownId: string) {
    const s = await tx.stockMovement.aggregate({ where: { itemId, godownId }, _sum: { qty: true } });
    return money((s._sum.qty ?? 0).toString());
  }

  private async goodsItem(tx: Tx, itemId: string) {
    const item = await tx.item.findFirst({ where: { id: itemId, archivedAt: null } });
    if (!item) throw new NotFoundException({ message: 'Choose an item.' });
    if (item.kind === 'service') throw new BadRequestException({ message: 'A service has no stock.' });
    return item;
  }

  adjustments(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const rows = await tx.stockAdjustment.findMany({ include: { item: { include: { unit: true } }, godown: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
      return rows.map((a) => ({
        id: a.id, number: a.number, date: isoOf(a.date), itemId: a.itemId, item: a.item.name, unit: a.item.unit?.code ?? '', godown: a.godown.name,
        qty: q3(a.qty), rate: toDb(a.rate.toString()), value: toDb(money(a.qty.toString()).abs().times(a.rate.toString())), reason: a.reason, cancelled: !!a.cancelledAt,
      }));
    });
  }

  adjust(ctx: RequestContext, input: StockAdjustmentInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const item = await this.goodsItem(tx, input.itemId);
      const godownId = input.godownId ?? (await tx.godown.findFirstOrThrow({ where: { isDefault: true, archivedAt: null } })).id;
      const qty = money(input.qty).toDecimalPlaces(3);
      const signed = input.mode === 'reduce' ? qty.neg() : qty;
      if (input.mode === 'reduce') {
        const have = await this.stockIn(tx, item.id, godownId);
        if (have.lt(qty)) throw new BadRequestException({ message: `Only ${q3(have)} in stock. You can’t reduce by more than that.` });
      }
      const number = await this.numbers.next(tx, ctx.businessId!, ctx.userId, 'stock_adjustment', input.date);
      const rate = toDb(input.rate ?? item.purchasePrice.toString());
      const a = await tx.stockAdjustment.create({
        data: { businessId: ctx.businessId!, createdBy: ctx.userId, number, date: day(input.date), itemId: item.id, godownId, qty: signed.toFixed(3), rate, reason: input.reason },
      });
      await tx.stockMovement.create({
        data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: item.id, godownId, date: day(input.date), qty: signed.toFixed(3), rate, kind: 'adjustment', sourceType: 'stock_adjustment', sourceId: a.id, note: input.reason },
      });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'stock_adjustment', entityId: a.id, after: a, ip: ctx.ip });
      return { id: a.id, number, stock: q3(await this.stockIn(tx, item.id, godownId)) };
    });
  }

  cancelAdjustment(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const a = await tx.stockAdjustment.findFirst({ where: { id } });
      if (!a) throw new NotFoundException({ message: 'That adjustment was not found.' });
      if (a.cancelledAt) throw new BadRequestException({ message: 'This adjustment is already cancelled.' });
      const back = money(a.qty.toString()).neg();
      if (back.lt(0) && (await this.stockIn(tx, a.itemId, a.godownId)).lt(back.abs()))
        throw new BadRequestException({ message: 'Cancelling this would make stock negative. Some of it has been sold since.' });
      await tx.stockAdjustment.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId } });
      await tx.stockMovement.create({
        data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: a.itemId, godownId: a.godownId, date: a.date, qty: back.toFixed(3), rate: a.rate, kind: 'cancel', sourceType: 'stock_adjustment', sourceId: a.id, note: `Cancelled ${a.number}` },
      });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'stock_adjustment', entityId: id, before: a, ip: ctx.ip });
    });
  }

  /* ───────── transfers ───────── */

  transfer(ctx: RequestContext, input: StockTransferInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const item = await this.goodsItem(tx, input.itemId);
      const [from, to] = await Promise.all([
        tx.godown.findFirst({ where: { id: input.fromGodownId, archivedAt: null } }),
        tx.godown.findFirst({ where: { id: input.toGodownId, archivedAt: null } }),
      ]);
      if (!from || !to) throw new NotFoundException({ message: 'Choose both godowns.' });
      const qty = money(input.qty).toDecimalPlaces(3);
      const have = await this.stockIn(tx, item.id, from.id);
      if (have.lt(qty)) throw new BadRequestException({ message: `Only ${q3(have)} ${'in ' + from.name}. Enter a smaller quantity.` });
      const number = await this.numbers.next(tx, ctx.businessId!, ctx.userId, 'stock_transfer', input.date);
      const t = await tx.stockTransfer.create({
        data: { businessId: ctx.businessId!, createdBy: ctx.userId, number, date: day(input.date), itemId: item.id, fromGodownId: from.id, toGodownId: to.id, qty: qty.toFixed(3), note: input.note },
      });
      const base = { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: item.id, date: day(input.date), rate: item.purchasePrice, kind: 'transfer', sourceType: 'stock_transfer', sourceId: t.id, note: number };
      await tx.stockMovement.createMany({ data: [{ ...base, godownId: from.id, qty: qty.neg().toFixed(3) }, { ...base, godownId: to.id, qty: qty.toFixed(3) }] });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'stock_transfer', entityId: t.id, after: t, ip: ctx.ip });
      return { id: t.id, number };
    });
  }

  cancelTransfer(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const t = await tx.stockTransfer.findFirst({ where: { id } });
      if (!t) throw new NotFoundException({ message: 'That transfer was not found.' });
      if (t.cancelledAt) throw new BadRequestException({ message: 'This transfer is already cancelled.' });
      const qty = money(t.qty.toString());
      if ((await this.stockIn(tx, t.itemId, t.toGodownId)).lt(qty)) throw new BadRequestException({ message: 'Cancelling this would make stock negative in the receiving godown.' });
      await tx.stockTransfer.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId } });
      const base = { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: t.itemId, date: t.date, kind: 'cancel', sourceType: 'stock_transfer', sourceId: t.id, note: `Cancelled ${t.number}` };
      await tx.stockMovement.createMany({ data: [{ ...base, godownId: t.toGodownId, qty: qty.neg().toFixed(3) }, { ...base, godownId: t.fromGodownId, qty: qty.toFixed(3) }] });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'stock_transfer', entityId: id, before: t, ip: ctx.ip });
    });
  }
}
