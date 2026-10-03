import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  addDays, DEFAULT_CATEGORIES, DEFAULT_COMMISSION, DEFAULT_PARTY_GROUPS, DEFAULT_PRICE_LISTS, DEFAULT_TAXES, DEFAULT_UNITS,
  financialYearOf, todayIst, type CreateBusinessInput,
} from '@billing/shared';
import { config } from '../../config';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';

/** Prototype default prefixes (INV-0412, PB-0209, DC-…). */
export const SERIES: ReadonlyArray<[docType: string, prefix: string]> = [
  ['invoice', 'INV-'], ['quotation', 'QT-'], ['challan', 'DC-'], ['credit_note', 'CN-'], ['receipt', 'PI-'],
  ['purchase_order', 'PO-'], ['bill', 'PB-'], ['debit_note', 'DN-'], ['payment', 'PO-PAY-'], ['expense', 'EXP-'],
  ['stock_adjustment', 'ADJ-'], ['stock_transfer', 'TRF-'],
];

const dateOnly = (iso: string) => new Date(iso + 'T00:00:00Z');

/** "Sharma Electricals & Hardware" -> "Sharma Electricals" (same rule as the website). */
export const shortName = (name: string) => name.split(/\s*&\s*|\s+and\s+/i)[0]!.trim() || name;

/** The lists a new shop starts with (same as the prototype after "Start fresh"). */
export async function seedMasters(tx: Tx, o: { businessId: string; userId: string; owner: string; phone: string; address: string }) {
  const base = { businessId: o.businessId, createdBy: o.userId };
  await tx.taxRate.createMany({
    data: DEFAULT_TAXES.map((t) => ({ ...base, kind: t.kind, name: t.name, rate: t.rate, note: t.note, isOld: !!t.old, legacyId: t.legacyId, isDefault: t.legacyId === 'g18' })),
  });
  await tx.partyGroup.createMany({ data: DEFAULT_PARTY_GROUPS.map((name) => ({ ...base, name })) });
  await tx.unit.createMany({ data: DEFAULT_UNITS.map((code) => ({ ...base, code })) });
  await tx.category.createMany({ data: DEFAULT_CATEGORIES.map((name) => ({ ...base, name })) });
  await tx.godown.create({ data: { ...base, name: 'Main shop', address: o.address, manager: o.owner, phone: o.phone.replace(/\D/g, '').slice(-10), isDefault: true } });
  const groups = await tx.partyGroup.findMany({ where: { businessId: o.businessId } });
  for (const pl of DEFAULT_PRICE_LISTS) {
    const row = await tx.priceList.create({ data: { ...base, name: pl.name, isDefault: pl.isDefault, rule: pl.rule, value: pl.value, roundTo: pl.roundTo, active: pl.active, legacyId: pl.legacyId } });
    const ids = groups.filter((g) => pl.groups.includes(g.name)).map((g) => g.id);
    if (ids.length) await tx.priceListRule.createMany({ data: ids.map((partyGroupId) => ({ ...base, priceListId: row.id, partyGroupId })) });
  }
  const cats = await tx.category.findMany({ where: { businessId: o.businessId } });
  await tx.commissionRule.createMany({
    data: cats.filter((c) => DEFAULT_COMMISSION[c.name]).map((c) => ({ ...base, categoryId: c.id, kind: DEFAULT_COMMISSION[c.name]!.kind, value: DEFAULT_COMMISSION[c.name]!.value })),
  });
}

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
      await seedMasters(tx, { businessId: id, userId: ctx.userId, owner: input.owner, phone: input.phone, address: [input.addr, [input.city, input.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ') });
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
