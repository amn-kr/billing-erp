import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { cancelSchema, paymentOutSchema, purchaseSchema, type PaymentOutInput, type PurchaseInput } from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { PurchasesService } from './purchases.service';
import { NeedsPasscode } from '../settings/passcode.interceptor';

const KINDS = ['bill', 'order', 'debit_note'] as const;

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
    return this.purchases.priceHistory(ctx, { itemId, partyId, exclude: exclude && /^[0-9a-f-]{36}$/i.test(exclude) ? exclude : undefined });
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

  @RequirePermission('purchases.manage')
  @NeedsPasscode('cancel', 'purchase')
  @Post('purchases/:id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.purchases.cancel(ctx, id, body.reason);
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
  @Get('parties/:id/unpaid-bills')
  unpaid(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.unpaid(ctx, id);
  }
}
