import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { formatNumber, PREFIX_HELP, PREFIX_RE, PREFIX_TYPES, prefixesClash } from '@billing/shared';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../../common/numbering.service';
import type { RequestContext } from '../../common/context';

const TYPES = PREFIX_TYPES.map(([t]) => t) as [string, ...string[]];
const prefix = z.string().trim().regex(PREFIX_RE, PREFIX_HELP);
const addSchema = z.object({ docType: z.enum(TYPES), prefix, active: z.boolean().optional().default(true) });
const editSchema = z.union([z.object({ prefix }).strict(), z.object({ active: z.literal(true) }).strict()]);
const shown = (p: string) => p || 'None';
const docs = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;

/**
 * Settings › Transactions › Transaction prefixes. Each document type has several prefixes, one
 * active (used for new documents only). A prefix any document was numbered with is locked: it
 * can't be edited or deleted, only stopped by making another prefix active.
 */
@Controller('settings/prefixes')
export class PrefixesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
  ) {}

  private scope = (ctx: RequestContext) => ({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email });

  private async list(tx: Tx, ctx: RequestContext) {
    // every type has an active prefix to show (a shop made before a type existed gets its default)
    for (const [t] of PREFIX_TYPES) await this.numbers.peek(tx, ctx.businessId!, ctx.userId, t);
    const rows = await tx.documentSeries.findMany({ where: { docType: { in: TYPES } }, orderBy: { createdAt: 'asc' } });
    const b = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId! } });
    const types = [];
    for (const [docType, label] of PREFIX_TYPES) {
      const prefixes = [];
      for (const r of rows.filter((x) => x.docType === docType)) {
        prefixes.push({
          id: r.id, prefix: r.prefix, active: r.active, used: await this.numbers.usedCount(tx, docType, r.prefix),
          next: r.active ? await this.numbers.peek(tx, ctx.businessId!, ctx.userId, docType) : formatNumber(r.prefix, r.nextNumber, r.padding),
        });
      }
      types.push({ docType, label, prefixes });
    }
    return { business: b.name, types };
  }

  private async row(tx: Tx, id: string) {
    const r = await tx.documentSeries.findFirst({ where: { id, docType: { in: TYPES } } });
    if (!r) throw new NotFoundException({ message: 'That prefix was not found.' });
    return r;
  }

  /** No two prefixes of a type may make the same number (“A” and “A1”), and “None” only once. */
  private async assertFree(tx: Tx, docType: string, p: string, exceptId?: string) {
    const others = await tx.documentSeries.findMany({ where: { docType, ...(exceptId && { id: { not: exceptId } }) } });
    const hit = others.find((o) => prefixesClash(o.prefix, p));
    if (!hit) return;
    const label = PREFIX_TYPES.find(([t]) => t === docType)![1];
    throw new ConflictException({
      message: hit.prefix.toUpperCase() === p.toUpperCase() ? `${label} already has the prefix ${shown(hit.prefix)}.` : `${shown(p)} could make the same numbers as ${shown(hit.prefix)}. Choose a different prefix.`,
      field: 'prefix',
    });
  }

  private async activate(tx: Tx, ctx: RequestContext, id: string, docType: string) {
    const old = await tx.documentSeries.findFirst({ where: { docType, active: true, id: { not: id } } });
    if (old) {
      await tx.documentSeries.update({ where: { id: old.id }, data: { active: false } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'document_series', entityId: old.id, before: old, after: { ...old, active: false, change: 'stopped using' }, ip: ctx.ip });
    }
    const after = await tx.documentSeries.update({ where: { id }, data: { active: true } });
    return { old, after };
  }

  @RequirePermission('business.view')
  @Get()
  get(@Ctx() ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), (tx) => this.list(tx, ctx));
  }

  /** Add a prefix; it becomes the active one unless “Make it active” is unticked. */
  @RequirePermission('settings.manage')
  @Post()
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(addSchema)) body: z.infer<typeof addSchema>) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      await this.assertFree(tx, body.docType, body.prefix);
      // its counter starts after any number already made with it (documents typed by hand or imported)
      const r = await tx.documentSeries.create({ data: { businessId: ctx.businessId!, docType: body.docType, prefix: body.prefix, nextNumber: 1, createdBy: ctx.userId } });
      await this.numbers.claimAll(tx, body.docType, r.id, r.prefix);
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'document_series', entityId: r.id, after: r, ip: ctx.ip });
      if (body.active) {
        const { after } = await this.activate(tx, ctx, r.id, r.docType);
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'document_series', entityId: r.id, before: r, after: { ...after, change: 'made active' }, ip: ctx.ip });
      }
      return this.list(tx, ctx);
    });
  }

  /** Make a prefix the active one, or change an unused prefix's letters. */
  @RequirePermission('settings.manage')
  @Patch(':id')
  edit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(editSchema)) body: z.infer<typeof editSchema>) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const before = await this.row(tx, id);
      if ('active' in body) {
        if (!before.active) {
          const { after } = await this.activate(tx, ctx, id, before.docType);
          await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'document_series', entityId: id, before, after: { ...after, change: 'made active' }, ip: ctx.ip });
        }
        return this.list(tx, ctx);
      }
      if (body.prefix === before.prefix) return this.list(tx, ctx);
      const used = await this.numbers.usedCount(tx, before.docType, before.prefix);
      if (used) throw new BadRequestException({ message: `${shown(before.prefix)} is used in ${docs(used)}, so it can’t be changed. Add a new prefix instead.` });
      await this.assertFree(tx, before.docType, body.prefix, id);
      const after = await tx.documentSeries.update({ where: { id }, data: { prefix: body.prefix } });
      await this.numbers.claimAll(tx, after.docType, after.id, after.prefix);
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'document_series', entityId: id, before, after: { ...after, change: 'edited' }, ip: ctx.ip });
      return this.list(tx, ctx);
    });
  }

  /** Delete a prefix no document uses. The active prefix can't be deleted (make another one active first). */
  @RequirePermission('settings.manage')
  @HttpCode(200)
  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const before = await this.row(tx, id);
      const used = await this.numbers.usedCount(tx, before.docType, before.prefix);
      if (used) throw new BadRequestException({ message: `${shown(before.prefix)} is used in ${docs(used)}, so it can’t be deleted. You can stop using it by making another prefix active.` });
      if (before.active) throw new BadRequestException({ message: `${shown(before.prefix)} is the active prefix. Make another prefix active before deleting it.` });
      await tx.documentSeries.delete({ where: { id } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'delete', entity: 'document_series', entityId: id, before, ip: ctx.ip });
      return this.list(tx, ctx);
    });
  }
}
