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
import { NeedsPasscode } from '../settings/passcode.interceptor';

/** A query value that is a uuid, else nothing. */
const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

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
  returnable(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query('except') except?: string) {
    return this.receipts.returnable(ctx, id, uuid(except));
  }

  @RequirePermission('sales.create')
  @Post('sales')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(saleSchema)) body: SaleInput) {
    return this.sales.save(ctx, body);
  }

  @RequirePermission('sales.create')
  @NeedsPasscode('edit', 'sale')
  @Put('sales/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(saleSchema)) body: SaleInput) {
    return this.sales.save(ctx, body, id);
  }

  @RequirePermission('sales.cancel')
  @HttpCode(200)
  @NeedsPasscode('cancel', 'sale')
  @Post('sales/:id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.sales.cancel(ctx, id, body.reason);
  }

  /** Delete an invoice, quotation, challan or credit note: undone like a cancel, then hidden from the lists (never erased). */
  @RequirePermission('sales.cancel')
  @HttpCode(200)
  @NeedsPasscode('delete', 'sale')
  @Post('sales/:id/delete')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.sales.delete(ctx, id, body.reason);
  }

  @RequirePermission('sales.view')
  @Get('parties/:id/dues')
  dues(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query('except') except?: string, @Query('payment') payment?: string) {
    return this.sales.dues(ctx, id, uuid(except), uuid(payment));
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
  @Get('receipts/:id')
  receipt(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.receipt(ctx, id);
  }

  @RequirePermission('sales.create')
  @NeedsPasscode('edit', 'receipt')
  @Put('receipts/:id')
  editReceipt(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(receiptSchema)) body: ReceiptInput) {
    return this.receipts.editReceipt(ctx, id, body);
  }

  /** Delete a payment received: cancelled in the books, then hidden from the lists (never erased). */
  @RequirePermission('sales.cancel')
  @HttpCode(200)
  @NeedsPasscode('delete', 'receipt')
  @Post('receipts/:id/delete')
  removeReceipt(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.receipts.delete(ctx, id, body.reason);
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

  @RequirePermission('sales.view')
  @Get('credit-notes/:id')
  creditNoteDoc(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.creditNoteDoc(ctx, id);
  }

  @RequirePermission('sales.create')
  @NeedsPasscode('edit', 'credit_note')
  @Put('credit-notes/:id')
  editCreditNote(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(creditNoteSchema)) body: CreditNoteInput) {
    return this.receipts.editCreditNote(ctx, id, body);
  }

  @RequirePermission('sales.create')
  @Post('challans')
  challan(@Ctx() ctx: RequestContext, @Body(new ZodPipe(challanSchema)) body: ChallanInput) {
    return this.receipts.challan(ctx, body);
  }

  @RequirePermission('sales.create')
  @NeedsPasscode('edit', 'challan')
  @Put('challans/:id')
  editChallan(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(challanSchema)) body: ChallanInput) {
    return this.receipts.editChallan(ctx, id, body);
  }
}
