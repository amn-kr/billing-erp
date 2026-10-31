import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { cancelSchema, paymentOutSchema, purchaseSchema, type PaymentOutInput, type PurchaseInput } from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { PurchasesService } from './purchases.service';
import { NeedsPasscode } from '../settings/passcode.interceptor';

const KINDS = ['bill', 'order', 'debit_note'] as const;
/** A query value that is a uuid, else nothing. */
const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/** Purchases: bills, orders, debit notes and payments made. */
@Controller()
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @RequirePermission('purchases.view')
  @Get('purchases/next-number')
  nextNumber(@Ctx() ctx: RequestContext, @Query('kind') kind = 'bill', @Query('date') date?: string) {
    return this.purchases.nextNumber(ctx, kind, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
  }

  @RequirePermission('purchases.view')
  @Get('purchases')
  list(@Ctx() ctx: RequestContext, @Query('kind') kind = 'bill') {
    if (!(KINDS as readonly string[]).includes(kind)) throw new BadRequestException({ message: 'Unknown document type.' });
    return this.purchases.list(ctx, kind as (typeof KINDS)[number]);
  }

  @RequirePermission('purchases.view')
  @Get('purchases/price-history')
  priceHistory(@Ctx() ctx: RequestContext, @Query('item', ParseUUIDPipe) itemId: string, @Query('party', ParseUUIDPipe) partyId: string, @Query('exclude') exclude?: string) {
    return this.purchases.priceHistory(ctx, { itemId, partyId, exclude: uuid(exclude) });
  }

  @RequirePermission('purchases.view')
  @Get('purchases/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.get(ctx, id);
  }

  @RequirePermission('purchases.manage')
  @Post('purchases')
  save(@Ctx() ctx: RequestContext, @Body(new ZodPipe(purchaseSchema)) body: PurchaseInput) {
    return this.purchases.save(ctx, body);
  }

  /** Edit a saved bill, order or debit note (same number; the passcode when it is switched on). */
  @RequirePermission('purchases.manage')
  @NeedsPasscode('edit', 'purchase')
  @Put('purchases/:id')
  edit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(purchaseSchema)) body: PurchaseInput) {
    return this.purchases.edit(ctx, id, body);
  }

  @RequirePermission('purchases.manage')
  @NeedsPasscode('cancel', 'purchase')
  @Post('purchases/:id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.purchases.cancel(ctx, id, body.reason);
  }

  /** Delete a bill or debit note: undone like a cancel, then hidden from the lists (never erased). */
  @RequirePermission('purchases.manage')
  @HttpCode(200)
  @NeedsPasscode('delete', 'purchase')
  @Post('purchases/:id/delete')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.purchases.delete(ctx, id, body.reason);
  }

  @RequirePermission('purchases.view')
  @Get('payments-made')
  payments(@Ctx() ctx: RequestContext) {
    return this.purchases.payments(ctx);
  }

  @RequirePermission('purchases.manage')
  @Post('payments-made')
  payOut(@Ctx() ctx: RequestContext, @Body(new ZodPipe(paymentOutSchema)) body: PaymentOutInput) {
    return this.purchases.payOut(ctx, body);
  }

  @RequirePermission('purchases.view')
  @Get('payments-made/:id')
  payment(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.payment(ctx, id);
  }

  @RequirePermission('purchases.manage')
  @NeedsPasscode('edit', 'payment')
  @Put('payments-made/:id')
  editPayOut(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(paymentOutSchema)) body: PaymentOutInput) {
    return this.purchases.editPayOut(ctx, id, body);
  }

  /** Delete a payment made: cancelled in the books, then hidden from the lists (never erased). */
  @RequirePermission('purchases.manage')
  @HttpCode(200)
  @NeedsPasscode('delete', 'payment')
  @Post('payments-made/:id/delete')
  removePayOut(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.purchases.deletePayOut(ctx, id, body.reason);
  }

  @RequirePermission('purchases.view')
  @Get('parties/:id/unpaid-bills')
  unpaid(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query('payment') payment?: string) {
    return this.purchases.unpaid(ctx, id, uuid(payment));
  }
}
