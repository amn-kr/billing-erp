import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { godownSchema, stockAdjustmentSchema, stockTransferSchema, type GodownInput, type StockAdjustmentInput, type StockTransferInput } from '@billing/shared';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { StockService } from './stock.service';

const godownUpdate = godownSchema.partial().extend({ isDefault: z.boolean().optional() });

@Controller()
export class StockController {
  constructor(private readonly stock: StockService) {}

  @RequirePermission('masters.view')
  @Get('godowns')
  godowns(@Ctx() ctx: RequestContext) {
    return this.stock.godowns(ctx);
  }

  @RequirePermission('masters.view')
  @Get('godowns/:id/items')
  godownItems(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.stock.godownItems(ctx, id);
  }

  @RequirePermission('masters.view')
  @Get('stock-transfers')
  transfers(@Ctx() ctx: RequestContext) {
    return this.stock.transfers(ctx);
  }

  @RequirePermission('masters.manage')
  @Post('godowns')
  addGodown(@Ctx() ctx: RequestContext, @Body(new ZodPipe(godownSchema)) body: GodownInput) {
    return this.stock.addGodown(ctx, body);
  }

  @RequirePermission('masters.manage')
  @Patch('godowns/:id')
  updateGodown(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(godownUpdate)) body: z.infer<typeof godownUpdate>) {
    return this.stock.updateGodown(ctx, id, body);
  }

  @RequirePermission('masters.manage')
  @HttpCode(204)
  @Post('godowns/:id/archive')
  archiveGodown(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.stock.archiveGodown(ctx, id);
  }

  @RequirePermission('masters.view')
  @Get('stock-adjustments')
  adjustments(@Ctx() ctx: RequestContext) {
    return this.stock.adjustments(ctx);
  }

  @RequirePermission('masters.manage')
  @Post('stock-adjustments')
  adjust(@Ctx() ctx: RequestContext, @Body(new ZodPipe(stockAdjustmentSchema)) body: StockAdjustmentInput) {
    return this.stock.adjust(ctx, body);
  }

  @RequirePermission('masters.manage')
  @HttpCode(204)
  @Post('stock-adjustments/:id/cancel')
  cancelAdjustment(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.stock.cancelAdjustment(ctx, id);
  }

  @RequirePermission('masters.manage')
  @Post('stock-transfers')
  transfer(@Ctx() ctx: RequestContext, @Body(new ZodPipe(stockTransferSchema)) body: StockTransferInput) {
    return this.stock.transfer(ctx, body);
  }

  @RequirePermission('masters.manage')
  @HttpCode(204)
  @Post('stock-transfers/:id/cancel')
  cancelTransfer(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.stock.cancelTransfer(ctx, id);
  }
}
