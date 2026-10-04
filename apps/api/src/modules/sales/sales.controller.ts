import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  cancelSchema, challanSchema, creditNoteSchema, receiptSchema, saleSchema,
  type ChallanInput, type CreditNoteInput, type ReceiptInput, type SaleInput,
} from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { SalesService } from './sales.service';
import { ReceiptsService } from './receipts.service';

/** Sales: invoices, item-wise quotations, challans, payments received, credit notes. */
@Controller()
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly receipts: ReceiptsService,
  ) {}

  @RequirePermission('sales.view')
  @Get('sales/price-history')
  priceHistory(@Ctx() ctx: RequestContext, @Query('item', ParseUUIDPipe) itemId: string, @Query('party') partyId?: string, @Query('name') cashName?: string, @Query('exclude') exclude?: string) {
    const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    return this.sales.priceHistory(ctx, { itemId, partyId: uuid(partyId), cashName, exclude: uuid(exclude) });
  }

  @RequirePermission('sales.view')
  @Get('sales/next-number')
  nextNumber(@Ctx() ctx: RequestContext, @Query('kind') kind = 'invoice', @Query('date') date?: string) {
    return this.sales.nextNumber(ctx, kind, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
  }

  @RequirePermission('sales.view')
  @Get('sales')
  list(@Ctx() ctx: RequestContext, @Query('kind') kind = 'invoice') {
    return this.sales.list(ctx, ['invoice', 'quotation', 'challan'].includes(kind) ? kind : 'invoice');
  }

  @RequirePermission('sales.view')
  @Get('sales/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(ctx, id);
  }

  @RequirePermission('sales.view')
  @Get('sales/:id/returnable')
  returnable(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.returnable(ctx, id);
  }

  @RequirePermission('sales.create')
  @Post('sales')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(saleSchema)) body: SaleInput) {
    return this.sales.save(ctx, body);
  }

  @RequirePermission('sales.create')
  @Put('sales/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(saleSchema)) body: SaleInput) {
    return this.sales.save(ctx, body, id);
  }

  @RequirePermission('sales.cancel')
  @HttpCode(200)
  @Post('sales/:id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.sales.cancel(ctx, id, body.reason);
  }

  @RequirePermission('sales.view')
  @Get('parties/:id/dues')
  dues(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query('except') except?: string) {
    return this.sales.dues(ctx, id, except && /^[0-9a-f-]{36}$/i.test(except) ? except : undefined);
  }

  @RequirePermission('sales.view')
  @Get('receipts')
  receiptList(@Ctx() ctx: RequestContext) {
    return this.receipts.receipts(ctx);
  }

  @RequirePermission('sales.create')
  @Post('receipts')
  receive(@Ctx() ctx: RequestContext, @Body(new ZodPipe(receiptSchema)) body: ReceiptInput) {
    return this.receipts.receive(ctx, body);
  }

  @RequirePermission('sales.view')
  @Get('credit-notes')
  creditNotes(@Ctx() ctx: RequestContext) {
    return this.receipts.creditNotes(ctx);
  }

  @RequirePermission('sales.create')
  @Post('credit-notes')
  creditNote(@Ctx() ctx: RequestContext, @Body(new ZodPipe(creditNoteSchema)) body: CreditNoteInput) {
    return this.receipts.creditNote(ctx, body);
  }

  @RequirePermission('sales.create')
  @Post('challans')
  challan(@Ctx() ctx: RequestContext, @Body(new ZodPipe(challanSchema)) body: ChallanInput) {
    return this.receipts.challan(ctx, body);
  }
}
