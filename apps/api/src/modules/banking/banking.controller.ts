import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { bankEntrySchema, cashBankAccountSchema, type BankEntryInput, type CashBankAccountInput } from '@billing/shared';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { BankingService } from './banking.service';

const countSchema = z.object({ counted: z.union([z.string(), z.number()]).transform((v) => String(v).replace(/[,₹\s]/g, '')).refine((v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0, 'Enter the cash counted.'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Banking & cash: accounts, each account's book, and money moved by hand. */
@Controller('banking')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  @RequirePermission('money.view')
  @Get('accounts')
  accounts(@Ctx() ctx: RequestContext) {
    return this.banking.accounts(ctx);
  }

  @RequirePermission('money.manage')
  @Post('accounts')
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(cashBankAccountSchema)) body: CashBankAccountInput) {
    return this.banking.addAccount(ctx, body);
  }

  @RequirePermission('money.manage')
  @Put('accounts/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cashBankAccountSchema)) body: CashBankAccountInput) {
    return this.banking.updateAccount(ctx, id, body);
  }

  @RequirePermission('money.manage')
  @Post('accounts/:id/remove')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.banking.removeAccount(ctx, id);
  }

  @RequirePermission('money.view')
  @Get('accounts/:id/book')
  book(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.banking.book(ctx, id);
  }

  @RequirePermission('money.manage')
  @Post('entries')
  move(@Ctx() ctx: RequestContext, @Body(new ZodPipe(bankEntrySchema)) body: BankEntryInput) {
    return this.banking.move(ctx, body);
  }

  @RequirePermission('money.view')
  @Get('entries/:id')
  entry(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.banking.entry(ctx, id);
  }

  @RequirePermission('money.manage')
  @Post('entries/:id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.banking.cancelEntry(ctx, id);
  }

  @RequirePermission('money.manage')
  @Post('count-cash')
  count(@Ctx() ctx: RequestContext, @Body(new ZodPipe(countSchema)) body: z.infer<typeof countSchema>) {
    return this.banking.countCash(ctx, body.counted, body.date);
  }
}
