import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { priceChangesSchema, priceListSchema, type PriceChangesInput, type PriceListInput } from '@billing/shared';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { PricingService } from './pricing.service';

const listUpdate = priceListSchema.partial().extend({ active: z.boolean().optional() });
const fixedSchema = z.object({ price: z.coerce.number().min(0).max(999_999_999_999).nullable() });

@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @RequirePermission('masters.view')
  @Get('price-lists')
  lists(@Ctx() ctx: RequestContext) {
    return this.pricing.priceLists(ctx);
  }

  @RequirePermission('masters.manage')
  @Post('price-lists')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(priceListSchema)) body: PriceListInput) {
    return this.pricing.createList(ctx, body);
  }

  @RequirePermission('masters.manage')
  @Patch('price-lists/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(listUpdate)) body: z.infer<typeof listUpdate>) {
    return this.pricing.updateList(ctx, id, body);
  }

  @RequirePermission('masters.manage')
  @HttpCode(204)
  @Put('price-lists/:id/items/:itemId')
  fixed(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(fixedSchema)) body: z.infer<typeof fixedSchema>) {
    return this.pricing.setFixed(ctx, id, itemId, body.price);
  }

  @RequirePermission('masters.view')
  @Get('prices')
  prices(@Ctx() ctx: RequestContext) {
    return this.pricing.prices(ctx);
  }

  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('prices/changes')
  changes(@Ctx() ctx: RequestContext, @Body(new ZodPipe(priceChangesSchema)) body: PriceChangesInput) {
    return this.pricing.applyChanges(ctx, body);
  }

  @RequirePermission('masters.view')
  @Get('prices/history')
  history(@Ctx() ctx: RequestContext, @Query('itemId') itemId?: string) {
    return this.pricing.history(ctx, itemId);
  }
}
