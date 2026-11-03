import { BadRequestException, Body, Controller, ForbiddenException, Put } from '@nestjs/common';
import { enabledFeatures, featureListProblem, FEATURES, itemOptionsSchema, readItemOptions, type ItemOptions } from '@billing/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Ctx } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DbService } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';

/** The whole list of features the owner wants on, so a list missing what a feature needs can be refused. */
const featuresSchema = z.object({ enabled: z.array(z.string().max(40)).max(50) }).strict();

/** Settings › Items: only the shop's owner, not a manager, can change what the shop uses. Everyone reads it from /me. */
@Controller('settings')
export class FeaturesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Put('features')
  save(@Ctx() ctx: RequestContext, @Body(new ZodPipe(featuresSchema)) body: z.infer<typeof featuresSchema>) {
    if (ctx.role !== 'owner') throw new ForbiddenException({ message: 'Only the shop owner can change features.' });
    const problem = featureListProblem(body.enabled);
    if (problem) throw new BadRequestException({ message: problem });
    const wanted = enabledFeatures(body.enabled);
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const s = await tx.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId! } });
      const before = enabledFeatures(s.features);
      const changed = FEATURES.map((f) => f.key).filter((k) => before.includes(k) !== wanted.includes(k));
      if (changed.length || s.features.join() !== wanted.join()) {
        await tx.businessSettings.update({ where: { businessId: ctx.businessId! }, data: { features: wanted } });
        for (const k of changed) {
          await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'feature', entityId: k, before: { on: before.includes(k) }, after: { on: wanted.includes(k) }, ip: ctx.ip });
        }
      }
      return { features: wanted };
    });
  }

  /** The labels, date formats and default unit: the whole set, so a label cleared goes back to the usual word. */
  @Put('item-options')
  saveOptions(@Ctx() ctx: RequestContext, @Body(new ZodPipe(itemOptionsSchema)) body: ItemOptions) {
    if (ctx.role !== 'owner') throw new ForbiddenException({ message: 'Only the shop owner can change item settings.' });
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const s = await tx.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId! } });
      const before = readItemOptions(s.itemOptions);
      if (body.defaultUnit && !(await tx.unit.findFirst({ where: { code: body.defaultUnit, archivedAt: null } }))) throw new BadRequestException({ message: `There is no unit ${body.defaultUnit}. Add it first.`, field: 'defaultUnit' });
      if (JSON.stringify(before) !== JSON.stringify(body)) {
        await tx.businessSettings.update({ where: { businessId: ctx.businessId! }, data: { itemOptions: body as Prisma.InputJsonValue } });
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'item_options', before, after: body, ip: ctx.ip });
      }
      return { itemOptions: body };
    });
  }
}
