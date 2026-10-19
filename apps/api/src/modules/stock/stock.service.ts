import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatQty, money, toDb, type GodownInput, type Money, type StockAdjustmentInput, type StockTransferInput } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf, uniqueMessage } from '../../common/lookups';
import { fieldChanges, keepNumber } from '../../common/editing';

const q3 = (v: { toString(): string } | number | string) => money(v.toString()).toDecimalPlaces(3).toFixed(3);
type Who = { businessId: string; userId: string };
type AdjustmentRow = NonNullable<Awaited<ReturnType<Tx['stockAdjustment']['findFirst']>>>;
type TransferRow = NonNullable<Awaited<ReturnType<Tx['stockTransfer']['findFirst']>>>;

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
        // like the prototype's cards: items with stock above zero here, valued at purchase price
        const mine = sums.filter((s) => s.godownId === g.id && money(s._sum.qty!.toString()).gt(0));
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
      return rows.map((t) => ({ id: t.id, number: t.number, date: isoOf(t.date), itemId: t.itemId, item: t.item.name, unit: t.item.unit?.code ?? '', qty: q3(t.qty), fromId: t.fromGodownId, from: t.fromGodown.name, toId: t.toGodownId, to: t.toGodown.name, note: t.note }));
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
    const item = await tx.item.findFirst({ where: { id: itemId, archivedAt: null }, include: { unit: true } });
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
    return this.db.scoped(this.scope(ctx), (tx) => this.writeAdjustment(tx, ctx, input));
  }

  /**
   * Edit a saved adjustment: its old stock movement is undone (the same rows a cancel adds) and the
   * new one written under the same number, in one go. Refused when it is cancelled, or when it
   * would take stock below zero because the goods were sold since (the rule cancel uses).
   */
  editAdjustment(ctx: RequestContext, id: string, input: StockAdjustmentInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const a = await tx.stockAdjustment.findFirst({ where: { id } });
      if (!a) throw new NotFoundException({ message: 'That adjustment was not found.' });
      if (a.cancelledAt) throw new BadRequestException({ message: 'This adjustment is cancelled, so it can’t be changed.' });
      keepNumber(input.number, a.number, 'adjustment');
      const before = await this.stockIn(tx, a.itemId, a.godownId);
      await this.undoAdjustment(tx, this.who(ctx), a, `Edited ${a.number}`);
      const out = await this.writeAdjustment(tx, ctx, { ...input, godownId: input.godownId ?? a.godownId }, a);
      await this.notBelowZero(tx, a.itemId, a.godownId, before, 'Saving this would make stock negative. Some of it has been sold since.');
      return out;
    });
  }

  /** A new adjustment, or (with `old`, its movement already undone) the saved one changed. */
  private async writeAdjustment(tx: Tx, ctx: RequestContext, input: StockAdjustmentInput, old?: AdjustmentRow) {
    const item = await this.goodsItem(tx, input.itemId);
    const godownId = input.godownId ?? (await tx.godown.findFirstOrThrow({ where: { isDefault: true, archivedAt: null } })).id;
    const qty = money(input.qty).toDecimalPlaces(3);
    const signed = input.mode === 'reduce' ? qty.neg() : qty;
    if (input.mode === 'reduce') {
      const have = await this.stockIn(tx, item.id, godownId);
      if (have.lt(qty)) throw new BadRequestException({ message: `Only ${formatQty(have)} in stock. You can’t reduce by more than that.` });
    }
    const number = old?.number ?? (await this.numbers.next(tx, ctx.businessId!, ctx.userId, 'stock_adjustment', input.date));
    const rate = toDb(input.rate ?? item.purchasePrice.toString());
    const data = { date: day(input.date), itemId: item.id, godownId, qty: signed.toFixed(3), rate, reason: input.reason };
    const a = old
      ? await tx.stockAdjustment.update({ where: { id: old.id }, data })
      : await tx.stockAdjustment.create({ data: { ...data, businessId: ctx.businessId!, createdBy: ctx.userId, number } });
    await tx.stockMovement.create({
      data: { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: item.id, godownId, date: day(input.date), qty: signed.toFixed(3), rate, kind: 'adjustment', sourceType: 'stock_adjustment', sourceId: a.id, note: input.reason },
    });
    await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: old ? 'update' : 'create', entity: 'stock_adjustment', entityId: a.id, before: old, ip: ctx.ip,
      after: old ? { ...a, changes: fieldChanges(old, a, ['date', 'itemId', 'godownId', 'qty', 'rate', 'reason']) } : a });
    return { id: a.id, number, stock: q3(await this.stockIn(tx, item.id, godownId)) };
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
      await this.undoAdjustment(tx, this.who(ctx), a, `Cancelled ${a.number}`);
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'stock_adjustment', entityId: id, before: a, ip: ctx.ip });
    });
  }

  /** The opposite of an adjustment's movement, on its own date and rate (used by cancel and edit). */
  private async undoAdjustment(tx: Tx, who: Who, a: AdjustmentRow, note: string) {
    await tx.stockMovement.create({
      data: { businessId: who.businessId, createdBy: who.userId, itemId: a.itemId, godownId: a.godownId, date: a.date, qty: money(a.qty.toString()).neg().toFixed(3), rate: a.rate, kind: 'cancel', sourceType: 'stock_adjustment', sourceId: a.id, note },
    });
  }

  private who(ctx: RequestContext): Who {
    return { businessId: ctx.businessId!, userId: ctx.userId };
  }

  /**
   * After an edit: the item's stock in that godown may not end below zero, unless it already was
   * and the edit made it no worse (e.g. only the reason changed).
   */
  private async notBelowZero(tx: Tx, itemId: string, godownId: string, before: Money, message: string) {
    const now = await this.stockIn(tx, itemId, godownId);
    if (now.lt(0) && now.lt(before)) throw new BadRequestException({ message });
  }

  /* ───────── transfers ───────── */

  transfer(ctx: RequestContext, input: StockTransferInput) {
    return this.db.scoped(this.scope(ctx), (tx) => this.writeTransfer(tx, ctx, input));
  }

  /**
   * Edit a saved transfer: both godowns get back what it moved (the same rows a cancel adds), then
   * the new transfer is written under the same number, in one go. Refused when it is cancelled, or
   * when the receiving godown no longer has the goods (sold or moved on since, the rule cancel uses).
   */
  editTransfer(ctx: RequestContext, id: string, input: StockTransferInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const t = await tx.stockTransfer.findFirst({ where: { id } });
      if (!t) throw new NotFoundException({ message: 'That transfer was not found.' });
      if (t.cancelledAt) throw new BadRequestException({ message: 'This transfer is cancelled, so it can’t be changed.' });
      keepNumber(input.number, t.number, 'transfer');
      const before = await this.stockIn(tx, t.itemId, t.toGodownId);
      await this.undoTransfer(tx, this.who(ctx), t, `Edited ${t.number}`);
      const out = await this.writeTransfer(tx, ctx, input, t);
      await this.notBelowZero(tx, t.itemId, t.toGodownId, before, 'Saving this would make stock negative in the receiving godown. Some of it has been sold or moved since.');
      return out;
    });
  }

  /** A new transfer, or (with `old`, its movements already undone) the saved one changed. */
  private async writeTransfer(tx: Tx, ctx: RequestContext, input: StockTransferInput, old?: TransferRow) {
    const item = await this.goodsItem(tx, input.itemId);
    const [from, to] = await Promise.all([
      tx.godown.findFirst({ where: { id: input.fromGodownId, archivedAt: null } }),
      tx.godown.findFirst({ where: { id: input.toGodownId, archivedAt: null } }),
    ]);
    if (!from || !to) throw new NotFoundException({ message: 'Choose both godowns.' });
    const qty = money(input.qty).toDecimalPlaces(3);
    const have = await this.stockIn(tx, item.id, from.id);
    if (have.lt(qty)) throw new BadRequestException({ message: `Only ${formatQty(have)}${item.unit ? ' ' + item.unit.code : ''} available in ${from.name}.` });
    const number = old?.number ?? (await this.numbers.next(tx, ctx.businessId!, ctx.userId, 'stock_transfer', input.date));
    const data = { date: day(input.date), itemId: item.id, fromGodownId: from.id, toGodownId: to.id, qty: qty.toFixed(3), note: input.note };
    const t = old
      ? await tx.stockTransfer.update({ where: { id: old.id }, data })
      : await tx.stockTransfer.create({ data: { ...data, businessId: ctx.businessId!, createdBy: ctx.userId, number } });
    const base = { businessId: ctx.businessId!, createdBy: ctx.userId, itemId: item.id, date: day(input.date), rate: item.purchasePrice, kind: 'transfer', sourceType: 'stock_transfer', sourceId: t.id, note: number };
    await tx.stockMovement.createMany({ data: [{ ...base, godownId: from.id, qty: qty.neg().toFixed(3) }, { ...base, godownId: to.id, qty: qty.toFixed(3) }] });
    await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: old ? 'update' : 'create', entity: 'stock_transfer', entityId: t.id, before: old, ip: ctx.ip,
      after: old ? { ...t, changes: fieldChanges(old, t, ['date', 'itemId', 'fromGodownId', 'toGodownId', 'qty', 'note']) } : t });
    return { id: t.id, number };
  }

  cancelTransfer(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const t = await tx.stockTransfer.findFirst({ where: { id } });
      if (!t) throw new NotFoundException({ message: 'That transfer was not found.' });
      if (t.cancelledAt) throw new BadRequestException({ message: 'This transfer is already cancelled.' });
      if ((await this.stockIn(tx, t.itemId, t.toGodownId)).lt(t.qty.toString())) throw new BadRequestException({ message: 'Cancelling this would make stock negative in the receiving godown.' });
      await tx.stockTransfer.update({ where: { id }, data: { cancelledAt: new Date(), cancelledBy: ctx.userId } });
      await this.undoTransfer(tx, this.who(ctx), t, `Cancelled ${t.number}`);
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'stock_transfer', entityId: id, before: t, ip: ctx.ip });
    });
  }

  /** Both godowns get back what a transfer moved, on its own date (used by cancel and edit). */
  private async undoTransfer(tx: Tx, who: Who, t: TransferRow, note: string) {
    const qty = money(t.qty.toString());
    const base = { businessId: who.businessId, createdBy: who.userId, itemId: t.itemId, date: t.date, kind: 'cancel', sourceType: 'stock_transfer', sourceId: t.id, note };
    await tx.stockMovement.createMany({ data: [{ ...base, godownId: t.toGodownId, qty: qty.neg().toFixed(3) }, { ...base, godownId: t.fromGodownId, qty: qty.toFixed(3) }] });
  }
}
