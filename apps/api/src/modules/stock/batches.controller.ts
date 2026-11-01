import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { batchEditSchema, type BatchEditInput } from '@billing/shared';
import { Ctx, RequirePermission } from '../../common/decorators';
import { AuditService } from '../../common/audit.service';
import { DbService } from '../../common/db.service';
import type { RequestContext } from '../../common/context';
import { day } from '../../common/lookups';
import { ZodPipe } from '../../common/zod.pipe';
import { batchDates, batchesOn, batchRows, batchRowsOf } from './batches';

/** Features › batch_expiry: an item's stock by batch, and correcting a batch's no. or dates. */
@Controller()
export class BatchesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  @RequirePermission('masters.view')
  @Get('items/:id/batches')
  list(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const item = await tx.item.findFirst({ where: { id }, select: { id: true, purchasePrice: true } });
      if (!item) throw new NotFoundException({ message: 'That item was not found.' });
      return (await batchesOn(tx, ctx.businessId!)) ? batchRows(tx, item) : { rows: [], shortQty: '0.000' };
    });
  }

  /** The sale editor: every tracked item's stock by batch, by item id. */
  @RequirePermission('masters.view')
  @Get('batches')
  all(@Ctx() ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      if (!(await batchesOn(tx, ctx.businessId!))) return {};
      const items = await tx.item.findMany({ where: { trackBatch: true, archivedAt: null, kind: { not: 'service' } }, select: { id: true, purchasePrice: true } });
      return Object.fromEntries([...(await batchRowsOf(tx, items))].map(([id, s]) => [id, s.rows]));
    });
  }

  @RequirePermission('masters.manage')
  @Patch('batches/:id')
  edit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(batchEditSchema)) body: BatchEditInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      if (!(await batchesOn(tx, ctx.businessId!))) throw new BadRequestException({ message: 'Batch and expiry is turned off for this shop.' });
      const before = await tx.batch.findFirst({ where: { id } });
      if (!before) throw new NotFoundException({ message: 'That batch was not found.' });
      const { mfg, expiry } = batchDates(body);
      const same = await tx.batch.findFirst({ where: { itemId: before.itemId, id: { not: id }, batchNo: { equals: body.batchNo, mode: 'insensitive' } } });
      if (same) throw new ConflictException({ message: `This item already has a batch ${same.batchNo}.`, field: 'batchNo' });
      const after = await tx.batch.update({ where: { id }, data: { batchNo: body.batchNo, mfgDate: mfg ? day(mfg) : null, expiryDate: expiry ? day(expiry) : null } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'batch', entityId: id, before, after, ip: ctx.ip });
      return { id };
    });
  }
}
