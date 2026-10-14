import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DEFAULT_TAXES, money } from '@billing/shared';
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
/** Settings › Print & invoice: one group (layout, columns, names, …); the web app fills in defaults for anything missing */
const printSchema = z.record(z.string().max(40), z.unknown()).refine((v) => JSON.stringify(v).length <= 20_000, 'The print settings are too large.');
const settingsSchema = z
  .object({
    gstEnabled: z.boolean(),
    /** the rest of the prototype's settings (S): reg, hsn, pos, rcm, cess, tcs, tds, upi, payQr, waLink, … */
    data: z
      .record(z.string().max(40), z.union([z.string().max(500), z.number(), z.boolean(), z.null(), printSchema]))
      .refine((d) => Object.entries(d).every(([k, v]) => k === 'print' || v === null || typeof v !== 'object'), 'Only the print settings can hold a group of values.'),
  })
  .partial();

const taxSchema = z.object({
  kind: z.enum(['GST', 'TCS', 'TDS']),
  name: z.string().trim().min(1, 'Enter a name for the tax.').max(60),
  rate: z.coerce.number({ invalid_type_error: 'Enter a rate between 0 and 100.' }).min(0, 'Enter a rate between 0 and 100.').max(100, 'Enter a rate between 0 and 100.'),
  note: z.string().trim().max(120).optional().default(''),
});
const ORDER = new Map(DEFAULT_TAXES.map((t, k) => [t.legacyId, k]));

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
      return { gstEnabled: s.gstEnabled, data: s.data, taxes: await this.taxes(tx) };
    });
  }

  /** The tax list in the prototype's order (its built-in rates first, then your own), with how many items use each GST rate. */
  private async taxes(tx: Parameters<Parameters<DbService['scoped']>[1]>[0]) {
    const rows = await tx.taxRate.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
    const kinds = ['GST', 'TCS', 'TDS'];
    rows.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || (ORDER.get(a.legacyId ?? '') ?? 999) - (ORDER.get(b.legacyId ?? '') ?? 999) || a.createdAt.getTime() - b.createdAt.getTime());
    const used = await tx.item.groupBy({ by: ['gstRate'], where: { archivedAt: null }, _count: { _all: true } });
    const n = (r: string) => used.find((u) => money(u.gstRate.toString()).eq(r))?._count._all ?? 0;
    return rows.map((t) => ({ id: t.id, kind: t.kind, name: t.name, rate: t.rate.toString(), note: t.note, isOld: t.isOld, isDefault: t.isDefault, used: t.kind === 'GST' ? n(t.rate.toString()) : 0 }));
  }

  /** Tax list › Add */
  @RequirePermission('settings.manage')
  @Post('taxes')
  addTax(@Ctx() ctx: RequestContext, @Body(new ZodPipe(taxSchema)) body: z.infer<typeof taxSchema>) {
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const same = await tx.taxRate.findFirst({ where: { active: true, kind: body.kind, name: { equals: body.name, mode: 'insensitive' } } });
      if (same) throw new ConflictException({ message: `A ${body.kind} rate named “${body.name}” already exists.`, field: 'name' });
      const t = await tx.taxRate.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, kind: body.kind, name: body.name, rate: String(body.rate), note: body.note || 'Custom rate' } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'tax_rate', entityId: t.id, after: t, ip: ctx.ip });
      return { taxes: await this.taxes(tx) };
    });
  }

  /** Tax list › ✕ — the rate is switched off (kept for old documents), not deleted. */
  @RequirePermission('settings.manage')
  @HttpCode(200)
  @Post('taxes/:id/remove')
  removeTax(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const list = await this.taxes(tx);
      const t = list.find((x) => x.id === id);
      if (!t) throw new NotFoundException({ message: 'That tax rate was not found.' });
      if (t.used) throw new BadRequestException({ message: `${t.name} is used by ${t.used} items. Move those items to another rate before deleting it.` });
      const s = await tx.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId! } });
      const d = (s.data ?? {}) as Record<string, unknown>;
      const chosen = (d.tcsRate ?? list.find((x) => x.kind === 'TCS')?.id) === id || (d.tdsRate ?? list.find((x) => x.kind === 'TDS')?.id) === id;
      if (chosen && list.filter((x) => x.kind === t.kind).length === 1) throw new BadRequestException({ message: `${t.name} is your only ${t.kind} rate. Add another before deleting it.` });
      await tx.taxRate.update({ where: { id }, data: { active: false } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'cancel', entity: 'tax_rate', entityId: id, before: t, ip: ctx.ip });
      return { taxes: await this.taxes(tx) };
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
