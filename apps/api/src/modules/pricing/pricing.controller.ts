import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { pinSchema, priceChangesSchema, priceListSchema, priceRuleSaveSchema, type PriceChangesInput, type PriceListInput, type PriceRuleSaveInput } from '@billing/shared';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { PricingService } from './pricing.service';

const listCreate = priceListSchema.extend({ pin: pinSchema });
const listUpdate = priceListSchema.partial().extend({ active: z.boolean().optional() });
const fixedSchema = z.object({ price: z.union([z.null(), z.coerce.number().min(0).max(999_999_999_999)]), pin: pinSchema });
const setPinSchema = z.object({ pin: pinSchema, currentPin: pinSchema.optional() });
const unlockSchema = z.object({ pin: pinSchema });

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
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(listCreate)) body: z.infer<typeof listCreate>) {
    return this.pricing.createList(ctx, body, body.pin);
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
    return this.pricing.setFixed(ctx, id, itemId, body.price, body.pin);
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

  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('prices/rules')
  saveRule(@Ctx() ctx: RequestContext, @Body(new ZodPipe(priceRuleSaveSchema)) body: PriceRuleSaveInput) {
    return this.pricing.saveRule(ctx, body);
  }

  /** Is a price PIN set? (the first unlock asks to set one) */
  @RequirePermission('masters.manage')
  @Get('prices/pin')
  pin(@Ctx() ctx: RequestContext) {
    return this.pricing.pinState(ctx);
  }

  @RequirePermission('masters.manage')
  @HttpCode(204)
  @Post('prices/pin')
  setPin(@Ctx() ctx: RequestContext, @Body(new ZodPipe(setPinSchema)) body: z.infer<typeof setPinSchema>) {
    return this.pricing.setPin(ctx, body.pin, body.currentPin);
  }

  /** Price Setup: check the PIN before showing the editor (changes check it again). */
  @RequirePermission('masters.manage')
  @HttpCode(204)
  @Post('prices/unlock')
  unlock(@Ctx() ctx: RequestContext, @Body(new ZodPipe(unlockSchema)) body: z.infer<typeof unlockSchema>) {
    return this.pricing.checkPin(ctx, body.pin);
  }

  @RequirePermission('masters.view')
  @Get('prices/history')
  history(@Ctx() ctx: RequestContext, @Query('itemId') itemId?: string) {
    return this.pricing.history(ctx, itemId);
  }
}
