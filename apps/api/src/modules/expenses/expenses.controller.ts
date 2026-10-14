import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { expenseSchema, type ExpenseInput } from '@billing/shared';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { ExpensesService } from './expenses.service';
import { NeedsPasscode } from '../settings/passcode.interceptor';

const nameSchema = z.object({ name: z.string().trim().max(60).default('') });

/** Expenses and their categories. */
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @RequirePermission('money.view')
  @Get('expenses')
  list(@Ctx() ctx: RequestContext) {
    return this.expenses.list(ctx);
  }

  @RequirePermission('money.view')
  @Get('expenses/next-number')
  next(@Ctx() ctx: RequestContext) {
    return this.expenses.nextNumber(ctx);
  }

  @RequirePermission('money.manage')
  @Post('expenses')
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(expenseSchema)) body: ExpenseInput) {
    return this.expenses.save(ctx, body);
  }

  @RequirePermission('money.manage')
  @NeedsPasscode('edit', 'expense')
  @Put('expenses/:id')
  edit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(expenseSchema)) body: ExpenseInput) {
    return this.expenses.save(ctx, body, id);
  }

  @RequirePermission('money.manage')
  @NeedsPasscode('cancel', 'expense')
  @Post('expenses/:id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.cancel(ctx, id);
  }

  @RequirePermission('money.view')
  @Get('expense-categories')
  categories(@Ctx() ctx: RequestContext) {
    return this.expenses.categories(ctx);
  }

  @RequirePermission('money.manage')
  @Post('expense-categories')
  addCategory(@Ctx() ctx: RequestContext, @Body(new ZodPipe(nameSchema)) body: z.infer<typeof nameSchema>) {
    return this.expenses.addCategory(ctx, body.name);
  }

  @RequirePermission('money.manage')
  @Put('expense-categories/:id')
  rename(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(nameSchema)) body: z.infer<typeof nameSchema>) {
    return this.expenses.renameCategory(ctx, id, body.name);
  }

  @RequirePermission('money.manage')
  @Post('expense-categories/:id/remove')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.removeCategory(ctx, id);
  }
}
