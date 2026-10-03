import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DbService } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';

/**
 * Shop settings (Settings screens). The prototype's many switches are kept as
 * one JSON object; known keys are typed here, unknown keys are refused.
 */
const settingsSchema = z
  .object({
    gstEnabled: z.boolean(),
    /** the rest of the prototype's settings (S): reg, hsn, pos, rcm, cess, tcs, tds, upi, payQr, waLink, … */
    data: z.record(z.string().max(40), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
  })
  .partial();

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission('business.view')
  @Get()
  get(@Ctx() ctx: RequestContext) {
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const s = await tx.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId! } });
      const taxes = await tx.taxRate.findMany({ where: { active: true }, orderBy: [{ kind: 'asc' }, { rate: 'asc' }] });
      return { gstEnabled: s.gstEnabled, data: s.data, taxes: taxes.map((t) => ({ id: t.id, kind: t.kind, name: t.name, rate: t.rate.toString(), note: t.note, isOld: t.isOld, isDefault: t.isDefault })) };
    });
  }

  @RequirePermission('settings.manage')
  @Patch()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const before = await tx.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId! } });
      const after = await tx.businessSettings.update({
        where: { businessId: ctx.businessId! },
        data: {
          ...(body.gstEnabled !== undefined && { gstEnabled: body.gstEnabled }),
          ...(body.data && { data: { ...(before.data as object), ...body.data } as Prisma.InputJsonValue }),
        },
      });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'settings', before, after, ip: ctx.ip });
      return { gstEnabled: after.gstEnabled, data: after.data };
    });
  }
}
