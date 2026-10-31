import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { bulkActiveSchema, bulkItemsSchema, importRowsSchema, itemSchema, itemUpdateSchema, nameSchema, unitSchema, type BulkActiveInput, type BulkItemsInput, type ImportRowsInput, type ItemInput } from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { ItemsService } from './items.service';
import { ItemImportService } from './item-import.service';
import { NeedsPasscode } from '../settings/passcode.interceptor';

@Controller()
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly importer: ItemImportService,
  ) {}

  @RequirePermission('masters.view')
  @Get('items')
  list(@Ctx() ctx: RequestContext, @Query('q') q?: string, @Query('kind') kind?: string, @Query('category') category?: string, @Query('brand') brand?: string, @Query('level') level?: string, @Query('archived') archived?: string) {
    return this.items.list(ctx, { search: q, kind, category, brand, level, archived: archived === 'all' ? 'all' : archived === 'true' });
  }

  @RequirePermission('masters.manage')
  @Get('items/next-code')
  nextCode(@Ctx() ctx: RequestContext) {
    return this.items.nextCode(ctx);
  }

  /** Items › Import products: what the shop has, to check the file's rows against */
  @RequirePermission('masters.manage')
  @Get('items/import/context')
  importContext(@Ctx() ctx: RequestContext) {
    return this.importer.context(ctx);
  }

  /** Final import: checks every row again and saves all of them in one go (or none) */
  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('items/import')
  importRows(@Ctx() ctx: RequestContext, @Body(new ZodPipe(importRowsSchema)) body: ImportRowsInput) {
    return this.importer.run(ctx, body);
  }

  /** Bulk update items: only the changed rows; all saved in one go (or none), with the edit passcode when it is on */
  @RequirePermission('masters.manage')
  @HttpCode(200)
  @NeedsPasscode('edit', 'item')
  @Post('items/bulk-update')
  bulkUpdate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(bulkItemsSchema)) body: BulkItemsInput) {
    return this.items.bulkUpdate(ctx, body);
  }

  /** Bulk active / inactive: the ticked items (up to 500), all changed in one go (or none); no passcode */
  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('items/bulk-active')
  bulkActive(@Ctx() ctx: RequestContext, @Body(new ZodPipe(bulkActiveSchema)) body: BulkActiveInput) {
    return this.items.bulkSetActive(ctx, body);
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

  @RequirePermission('masters.view')
  @Get('items/:id/usage')
  usage(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.usage(ctx, id);
  }

  /** Delete an item that was never used (no passcode: only documents have one); a used one is refused. */
  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('items/:id/delete')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.delete(ctx, id);
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
