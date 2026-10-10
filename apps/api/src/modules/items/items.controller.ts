import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { itemSchema, itemUpdateSchema, nameSchema, unitSchema, type ItemInput } from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { ItemsService } from './items.service';

@Controller()
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @RequirePermission('masters.view')
  @Get('items')
  list(@Ctx() ctx: RequestContext, @Query('q') q?: string, @Query('kind') kind?: string, @Query('category') category?: string, @Query('brand') brand?: string, @Query('level') level?: string, @Query('archived') archived?: string) {
    return this.items.list(ctx, { search: q, kind, category, brand, level, archived: archived === 'true' });
  }

  @RequirePermission('masters.manage')
  @Get('items/next-code')
  nextCode(@Ctx() ctx: RequestContext) {
    return this.items.nextCode(ctx);
  }

  @RequirePermission('masters.view')
  @Get('items/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.get(ctx, id);
  }

  @RequirePermission('masters.manage')
  @Post('items')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(itemSchema)) body: ItemInput) {
    return this.items.create(ctx, body);
  }

  @RequirePermission('masters.manage')
  @Patch('items/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(itemUpdateSchema)) body: Partial<ItemInput>) {
    return this.items.update(ctx, id, body);
  }

  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('items/:id/archive')
  archive(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.setArchived(ctx, id, true);
  }

  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('items/:id/restore')
  restore(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.setArchived(ctx, id, false);
  }

  @RequirePermission('masters.view')
  @Get('catalogue')
  lists(@Ctx() ctx: RequestContext) {
    return this.items.lists(ctx);
  }

  @RequirePermission('masters.manage')
  @Post('catalogue/categories')
  addCategory(@Ctx() ctx: RequestContext, @Body(new ZodPipe(nameSchema)) body: z.infer<typeof nameSchema>) {
    return this.items.addNamed(ctx, 'category', body.name);
  }

  @RequirePermission('masters.manage')
  @Post('catalogue/brands')
  addBrand(@Ctx() ctx: RequestContext, @Body(new ZodPipe(nameSchema)) body: z.infer<typeof nameSchema>) {
    return this.items.addNamed(ctx, 'brand', body.name);
  }

  @RequirePermission('masters.manage')
  @Post('catalogue/units')
  addUnit(@Ctx() ctx: RequestContext, @Body(new ZodPipe(unitSchema)) body: z.infer<typeof unitSchema>) {
    return this.items.addUnit(ctx, body.code, body.name);
  }
}
