import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { brandSchema, brandUpdateSchema, seriesFromItemsSchema, seriesSchema, seriesUpdateSchema, type BrandInput, type BrandUpdate, type SeriesInput, type SeriesUpdate } from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { BrandsService } from './brands.service';

/** Items › Brands & Series. There is no delete: brands and series are made inactive. */
@Controller()
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @RequirePermission('masters.view')
  @Get('brands')
  list(@Ctx() ctx: RequestContext) {
    return this.brands.brands(ctx);
  }

  @RequirePermission('masters.manage')
  @Post('brands')
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(brandSchema)) body: BrandInput) {
    return this.brands.addBrand(ctx, body);
  }

  @RequirePermission('masters.manage')
  @Patch('brands/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(brandUpdateSchema)) body: BrandUpdate) {
    return this.brands.updateBrand(ctx, id, body);
  }

  @RequirePermission('masters.view')
  @Get('brand-series')
  series(@Ctx() ctx: RequestContext) {
    return this.brands.series(ctx);
  }

  @RequirePermission('masters.manage')
  @Post('brand-series')
  addSeries(@Ctx() ctx: RequestContext, @Body(new ZodPipe(seriesSchema)) body: SeriesInput) {
    return this.brands.addSeries(ctx, body);
  }

  /** A series so far typed only on items (no id yet), found by its brand and name. */
  @RequirePermission('masters.manage')
  @Patch('brand-series')
  updateFromItems(@Ctx() ctx: RequestContext, @Body(new ZodPipe(seriesFromItemsSchema)) body: z.infer<typeof seriesFromItemsSchema>) {
    const { from, ...change } = body;
    return this.brands.updateSeries(ctx, from, change);
  }

  @RequirePermission('masters.manage')
  @Patch('brand-series/:id')
  updateSeries(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(seriesUpdateSchema)) body: SeriesUpdate) {
    return this.brands.updateSeries(ctx, { id }, body);
  }
}
