import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_QUOTE_GRID, brandQuoteSchema, money, quoteGridSchema, toDb } from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import type { RequestContext } from '../../common/context';
import { day } from '../../common/lookups';
import { booksOf } from './sales.service';

type Grid = z.infer<typeof quoteGridSchema>;
type BrandQuote = z.infer<typeof brandQuoteSchema>;

/**
 * Brand-wise quotations (prototype vQuo): the shop's grid of item rows and brand ranges, and
 * saved quotations (a quotation document whose quantities, ranges and discount are in `extra`).
 * Item-wise quotations are saved through POST /sales like invoices.
 */
@Controller()
export class QuotesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  @RequirePermission('sales.view')
  @Get('quote-grid')
  grid(@Ctx() ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const s = await tx.businessSettings.findUnique({ where: { businessId: ctx.businessId! } });
      return ((s?.data ?? {}) as { quoteGrid?: Grid }).quoteGrid ?? DEFAULT_QUOTE_GRID;
    });
  }

  /** Add or remove brand ranges and item rows. */
  @RequirePermission('sales.create')
  @Put('quote-grid')
  saveGrid(@Ctx() ctx: RequestContext, @Body(new ZodPipe(quoteGridSchema)) body: Grid) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const s = await tx.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId! } });
      const data = (s.data ?? {}) as Record<string, unknown>;
      await tx.businessSettings.update({ where: { businessId: ctx.businessId! }, data: { data: { ...data, quoteGrid: body } as Prisma.InputJsonValue } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'quote_grid', entityId: ctx.businessId!, before: data.quoteGrid ?? null, after: body, ip: ctx.ip });
      return body;
    });
  }

  @RequirePermission('sales.create')
  @Post('quotations/brand')
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(brandQuoteSchema)) body: BrandQuote) {
    return this.db.scoped(this.scope(ctx), (tx) => this.write(tx, ctx, body, null));
  }

  @RequirePermission('sales.create')
  @Put('quotations/brand/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(brandQuoteSchema)) body: BrandQuote) {
    return this.db.scoped(this.scope(ctx), (tx) => this.write(tx, ctx, body, id));
  }

  private async write(tx: Tx, ctx: RequestContext, q: BrandQuote, id: string | null) {
    const businessId = ctx.businessId!;
    const before = id ? await tx.salesDocument.findFirst({ where: { id, kind: 'quotation' } }) : null;
    if (id && !before) throw new NotFoundException({ message: 'That quotation was not found.' });
    if (before?.cancelledAt) throw new BadRequestException({ message: `${before.number} is cancelled. It can’t be changed.` });
    if (before?.status === 'converted') throw new BadRequestException({ message: 'This quotation is locked and can’t be edited.' });
    let number = q.number.trim() || before?.number || '';
    if (number && number !== before?.number) {
      const used = await tx.salesDocument.findFirst({ where: { kind: 'quotation', number, ...(id && { id: { not: id } }) } });
      if (used) throw new BadRequestException({ message: `Quotation number ${number} is already used.`, field: 'number' });
      await this.numbers.claim(tx, businessId, ctx.userId, 'quotation', q.date, number);
    }
    if (!number) number = await this.numbers.next(tx, businessId, ctx.userId, 'quotation', q.date);
    // a customer typed by name is linked when a party has that name (prototype matches by name)
    const party = q.cust ? await tx.party.findFirst({ where: { archivedAt: null, name: { equals: q.cust, mode: 'insensitive' } } }) : null;
    const books = await booksOf(tx, businessId);
    const data = {
      number, date: day(q.date), mode: party ? 'credit' : 'cash', partyId: party?.id ?? null, cashName: party ? '' : q.cust, taxMode: books.mode, placeOfSupply: books.state,
      total: toDb(money(q.low?.total ?? 0).toDecimalPlaces(2).toString()), referrerId: q.referrerId ?? null,
      extra: { type: 'brand', cust: q.cust, priceListId: q.priceListId ?? null, disc: q.disc, sel: q.sel, qty: q.qty, items: q.items, pcs: q.pcs, low: q.low } as Prisma.InputJsonValue,
    };
    const doc = before
      ? await tx.salesDocument.update({ where: { id: before.id }, data })
      : await tx.salesDocument.create({ data: { ...data, businessId, kind: 'quotation', status: 'open', createdBy: ctx.userId } });
    await this.audit.log(tx, { businessId, userId: ctx.userId, action: before ? 'update' : 'create', entity: 'sales_document', entityId: doc.id, before, after: doc, ip: ctx.ip });
    return { id: doc.id, number: doc.number };
  }
}
