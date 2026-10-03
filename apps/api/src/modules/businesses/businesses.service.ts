import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { addDays, financialYearOf, todayIst, type CreateBusinessInput } from '@billing/shared';
import { config } from '../../config';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';

/** Prototype default prefixes (INV-0412, PB-0209, DC-…). */
export const SERIES: ReadonlyArray<[docType: string, prefix: string]> = [
  ['invoice', 'INV-'], ['quotation', 'QT-'], ['challan', 'DC-'], ['credit_note', 'CN-'], ['receipt', 'PI-'],
  ['purchase_order', 'PO-'], ['bill', 'PB-'], ['debit_note', 'DN-'], ['payment', 'PO-PAY-'], ['expense', 'EXP-'],
];

/** Standard GST slabs, as in the prototype's tax list. */
export const GST_RATES: ReadonlyArray<[name: string, rate: string]> = [
  ['GST 0%', '0'], ['GST 0.25%', '0.25'], ['GST 3%', '3'], ['GST 5%', '5'], ['GST 12%', '12'], ['GST 18%', '18'], ['GST 28%', '28'],
];

const dateOnly = (iso: string) => new Date(iso + 'T00:00:00Z');

/** "Sharma Electricals & Hardware" -> "Sharma Electricals" (same rule as the website). */
export const shortName = (name: string) => name.split(/\s*&\s*|\s+and\s+/i)[0]!.trim() || name;

@Injectable()
export class BusinessesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Sets up everything a new shop needs, in one transaction. The creator becomes the owner. */
  async create(ctx: Pick<RequestContext, 'userId' | 'email' | 'ip'>, input: CreateBusinessInput, opts: { today?: string; trialDays?: number } = {}) {
    const id = randomUUID();
    const today = opts.today ?? todayIst();
    const fy = financialYearOf(today);
    return this.db.scoped({ businessId: id, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const [row] = await tx.$queryRaw<{ code: string }[]>`SELECT 'BE-' || nextval('business_code_seq') AS code`;
      const code = row!.code;
      const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      if (!user.name) await tx.user.update({ where: { id: user.id }, data: { name: input.owner } });
      const business = await tx.business.create({
        data: {
          id, code, name: input.name, shortName: shortName(input.name), ownerId: ctx.userId,
          phone: input.phone, email: ctx.email, address: input.addr, city: input.city, pin: input.pin,
          stateCode: input.state, gstin: input.gstin, planStatus: 'trial',
          trialEndsOn: dateOnly(addDays(today, opts.trialDays ?? config().TRIAL_DAYS)), createdBy: ctx.userId,
        },
      });
      const owner = await tx.role.findFirstOrThrow({ where: { businessId: null, key: 'owner' } });
      await tx.membership.create({ data: { businessId: id, userId: ctx.userId, roleId: owner.id, displayName: input.owner, createdBy: ctx.userId } });
      await tx.businessSettings.create({ data: { businessId: id, gstEnabled: !!input.gstin, data: { showCurrency: false, mrp: false }, createdBy: ctx.userId } });
      const year = await tx.financialYear.create({
        data: { businessId: id, label: fy.label, startDate: dateOnly(fy.start), endDate: dateOnly(fy.end), createdBy: ctx.userId },
      });
      await tx.documentSeries.createMany({
        data: SERIES.map(([docType, prefix]) => ({
          businessId: id, financialYearId: year.id, docType, prefix, nextNumber: docType === 'invoice' ? +input.inv || 1 : 1, createdBy: ctx.userId,
        })),
      });
      await tx.taxRate.createMany({
        data: GST_RATES.map(([name, rate]) => ({ businessId: id, name, rate, isDefault: rate === '18', createdBy: ctx.userId })),
      });
      await this.audit.log(tx, { businessId: id, userId: ctx.userId, action: 'create', entity: 'business', entityId: id, after: business, ip: ctx.ip });
      return business;
    });
  }

  async assertMember(ctx: Pick<RequestContext, 'userId' | 'email'>, businessId: string): Promise<void> {
    const m = await this.db.scoped({ userId: ctx.userId, email: ctx.email }, (tx) =>
      tx.membership.findFirst({ where: { businessId, userId: ctx.userId, status: 'active' } }),
    );
    if (!m) throw new ForbiddenException({ message: 'You are not a member of that shop.' });
  }

  current(ctx: RequestContext) {
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, (tx) =>
      tx.business.findUniqueOrThrow({ where: { id: ctx.businessId! }, include: { settings: true } }),
    );
  }

  async update(ctx: RequestContext, input: Partial<CreateBusinessInput>) {
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx: Tx) => {
      const before = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId! } });
      const after = await tx.business.update({
        where: { id: before.id },
        data: {
          ...(input.name !== undefined && { name: input.name, shortName: shortName(input.name) }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.addr !== undefined && { address: input.addr }),
          ...(input.city !== undefined && { city: input.city }),
          ...(input.pin !== undefined && { pin: input.pin }),
          ...(input.state !== undefined && { stateCode: input.state }),
          ...(input.gstin !== undefined && { gstin: input.gstin }),
        },
      });
      await this.audit.log(tx, { businessId: before.id, userId: ctx.userId, action: 'update', entity: 'business', entityId: before.id, before, after, ip: ctx.ip });
      return after;
    });
  }
}
