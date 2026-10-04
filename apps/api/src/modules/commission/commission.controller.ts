import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { commissionRuleSchema, referrerSchema } from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DbService } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { namedId } from '../../common/lookups';

/** Electricians (referrers) and commission per item category. */
@Controller()
export class CommissionController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  @RequirePermission('masters.view')
  @Get('referrers')
  list(@Ctx() ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), (tx) => tx.referrer.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, phone: true, city: true, partyId: true } }));
  }

  @RequirePermission('masters.manage')
  @Post('referrers')
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(referrerSchema)) body: z.infer<typeof referrerSchema>) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      // electricians are parties too (prototype elecParty): link the customer with the same mobile or
      // name, or add one in the "Electricians" group with 15 days' credit
      let partyId = body.partyId ?? null;
      if (!partyId) {
        const same = await tx.party.findFirst({
          where: { archivedAt: null, kind: { not: 'supplier' }, OR: [...(body.phone ? [{ phone: body.phone }] : []), { name: { equals: body.name, mode: 'insensitive' as const } }] },
          orderBy: { createdAt: 'asc' },
        }) ?? await tx.party.findFirst({ where: { archivedAt: null, name: { equals: body.name, mode: 'insensitive' as const } } }); // names are unique, even across suppliers
        if (same) partyId = same.id;
        else {
          const groupId = await namedId(tx, 'partyGroup', ctx.businessId!, ctx.userId, 'Electricians');
          const p = await tx.party.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, groupId, name: body.name, phone: body.phone, kind: 'customer', creditDays: 15, openingType: 'receive' } });
          if (body.city) await tx.partyAddress.create({ data: { businessId: ctx.businessId!, partyId: p.id, createdBy: ctx.userId, kind: 'billing', city: body.city } });
          await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'party', entityId: p.id, after: p, ip: ctx.ip });
          partyId = p.id;
        }
      }
      const r = await tx.referrer.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, name: body.name, phone: body.phone, city: body.city, partyId } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'referrer', entityId: r.id, after: r, ip: ctx.ip });
      return r;
    });
  }

  @RequirePermission('masters.manage')
  @Patch('referrers/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(referrerSchema.partial())) body: Partial<z.infer<typeof referrerSchema>>) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const before = await tx.referrer.findFirst({ where: { id } });
      if (!before) throw new NotFoundException({ message: 'That electrician was not found.' });
      const after = await tx.referrer.update({ where: { id }, data: body });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'referrer', entityId: id, before, after, ip: ctx.ip });
      return after;
    });
  }

  @RequirePermission('masters.view')
  @Get('commission-rules')
  rules(@Ctx() ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const rows = await tx.commissionRule.findMany({ include: { category: true } });
      return rows.map((r) => ({ category: r.category.name, kind: r.kind, value: r.value.toString() }));
    });
  }

  @RequirePermission('masters.manage')
  @Put('commission-rules')
  setRule(@Ctx() ctx: RequestContext, @Body(new ZodPipe(commissionRuleSchema)) body: z.infer<typeof commissionRuleSchema>) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const categoryId = (await namedId(tx, 'category', ctx.businessId!, ctx.userId, body.category))!;
      const value = body.kind === 'none' ? '0' : String(body.value);
      const r = await tx.commissionRule.upsert({
        where: { businessId_categoryId: { businessId: ctx.businessId!, categoryId } },
        create: { businessId: ctx.businessId!, createdBy: ctx.userId, categoryId, kind: body.kind, value },
        update: { kind: body.kind, value },
      });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'commission_rule', entityId: r.id, after: body, ip: ctx.ip });
      return { category: body.category, kind: r.kind, value: r.value.toString() };
    });
  }
}
