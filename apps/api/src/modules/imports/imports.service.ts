import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extractSnapshot, ImportError, parseBackup, planImport, type ImportPlan, type PlanOptions } from '@billing/importer';
import type { Prisma } from '@prisma/client';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { shortName } from '../businesses/businesses.service';

export interface ImportRequest extends PlanOptions {
  fileName: string;
  /** the backup file's text */
  text: string;
  dryRun?: boolean;
}

export interface ImportResult {
  dryRun: boolean;
  importId: string | null;
  counts: Record<string, number>;
  warnings: string[];
}

export interface ImportActor {
  userId: string;
  email: string;
  businessId: string;
  ip: string;
}

const day = (iso: string) => new Date(iso + 'T00:00:00Z');

/**
 * Prototype backup → this shop's tables, in one transaction: either all of it
 * goes in, or nothing does. Only into a shop that has no parties or items yet,
 * so an import can never double up a shop's books.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async plan(req: Pick<ImportRequest, 'text' | 'includeSample'>): Promise<{ plan: ImportPlan; backupAt: string }> {
    try {
      const backup = parseBackup(req.text);
      const snap = await extractSnapshot(backup);
      return { plan: planImport(snap, { includeSample: req.includeSample }), backupAt: backup.at };
    } catch (e) {
      if (e instanceof ImportError) throw new UnprocessableEntityException({ message: e.message });
      throw e;
    }
  }

  async run(actor: ImportActor, req: ImportRequest): Promise<ImportResult> {
    const { plan, backupAt } = await this.plan(req);
    if (req.dryRun) return { dryRun: true, importId: null, counts: plan.counts, warnings: plan.warnings };
    const importId = await this.db.scoped({ businessId: actor.businessId, userId: actor.userId, email: actor.email }, (tx) => this.write(tx, actor, plan, req.fileName, backupAt), { timeout: 120_000 });
    return { dryRun: false, importId, counts: plan.counts, warnings: plan.warnings };
  }

  private async write(tx: Tx, actor: ImportActor, plan: ImportPlan, fileName: string, backupAt: string): Promise<string> {
    const businessId = actor.businessId;
    const base = { businessId, createdBy: actor.userId };
    const [parties, items] = await Promise.all([tx.party.count(), tx.item.count()]);
    if (parties || items) throw new ConflictException({ message: 'This shop already has parties or items. Import into a new, empty shop so nothing is entered twice.' });

    /* business details and settings */
    const b = plan.business;
    const before = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    await tx.business.update({
      where: { id: businessId },
      data: {
        ...(b.name && { name: b.name, shortName: b.short || shortName(b.name) }),
        phone: b.phone || before.phone, address: b.addr || before.address, city: b.city || before.city, pin: b.pin || before.pin,
        stateCode: b.state || before.stateCode, gstin: b.gstin,
      },
    });
    const settings = await tx.businessSettings.findUniqueOrThrow({ where: { businessId } });
    await tx.businessSettings.update({
      where: { businessId },
      data: { gstEnabled: b.gstEnabled, data: { ...(settings.data as object), imported: plan.settings, upi: b.upi, priceRules: plan.priceRules } as Prisma.InputJsonValue },
    });
    await tx.documentSeries.updateMany({ where: { docType: 'invoice' }, data: { nextNumber: b.invoiceNext } });

    /* tax list: update the matching default, add custom ones */
    const taxes = await tx.taxRate.findMany();
    for (const t of plan.taxes) {
      const hit = taxes.find((x) => x.legacyId === t.legacyId) ?? taxes.find((x) => x.kind === t.kind && x.name === t.name);
      if (hit) await tx.taxRate.update({ where: { id: hit.id }, data: { name: t.name, rate: t.rate, note: t.note, isOld: t.isOld, legacyId: t.legacyId } });
      else await tx.taxRate.create({ data: { ...base, kind: t.kind, name: t.name, rate: t.rate, note: t.note, isOld: t.isOld, legacyId: t.legacyId } });
    }

    /* simple lists */
    const ensure = async <K extends 'partyGroup' | 'category' | 'brand' | 'itemGroup'>(model: K, names: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = tx[model] as any;
      await m.createMany({ data: names.map((name: string) => ({ ...base, name })), skipDuplicates: true });
      const rows: { id: string; name: string }[] = await m.findMany({ select: { id: true, name: true } });
      return new Map(rows.map((r) => [r.name, r.id]));
    };
    const groupId = await ensure('partyGroup', plan.partyGroups);
    const categoryId = await ensure('category', plan.categories);
    const brandId = await ensure('brand', plan.brands);
    const itemGroupId = await ensure('itemGroup', plan.itemGroups);
    await tx.unit.createMany({ data: plan.units.map((code) => ({ ...base, code })), skipDuplicates: true });
    const unitId = new Map((await tx.unit.findMany()).map((u) => [u.code, u.id]));

    /* parties */
    const partyId = new Map<string, string>();
    for (const p of plan.parties) partyId.set(p.legacyId, randomUUID());
    await tx.party.createMany({
      // keep the old app's order: the day each party was added, then its place in the list
      data: plan.parties.map((p, k) => ({
        ...base, id: partyId.get(p.legacyId)!, ...(p.addedOn && { createdAt: new Date(Date.parse(p.addedOn + 'T00:00:00+05:30') + k * 1000) }), legacyId: p.legacyId, name: p.name, kind: p.kind, groupId: groupId.get(p.group) ?? null,
        phone: p.phone, email: p.email, gstin: p.gstin, gstType: p.gstType, stateCode: p.stateCode, creditLimit: p.creditLimit,
        creditDays: p.creditDays, openingBalance: p.opening?.amount ?? '0', openingType: p.opening?.type ?? (p.kind === 'supplier' ? 'pay' : 'receive'),
        openingDate: p.opening ? day(p.opening.date) : null,
      })),
    });
    await tx.partyAddress.createMany({
      data: plan.parties.flatMap((p) => [
        ...(p.billing ? [{ ...base, partyId: partyId.get(p.legacyId)!, kind: 'billing', line: p.billing.line, city: p.billing.city, pin: p.billing.pin, stateCode: p.billing.stateCode }] : []),
        ...(p.shipping ? [{ ...base, partyId: partyId.get(p.legacyId)!, kind: 'shipping', line: p.shipping.line }] : []),
      ]),
    });
    await tx.partyContact.createMany({ data: plan.parties.flatMap((p) => p.contacts.map((c) => ({ ...base, partyId: partyId.get(p.legacyId)!, label: c.label, value: c.value }))) });

    /* items and opening stock */
    const itemId = new Map<string, string>();
    for (const i of plan.items) itemId.set(i.legacyId, randomUUID());
    await tx.item.createMany({
      data: plan.items.map((i) => ({
        ...base, id: itemId.get(i.legacyId)!, legacyId: i.legacyId, kind: i.kind, name: i.name, code: i.code, hsn: i.hsn,
        unitId: unitId.get(i.unit) ?? null, categoryId: categoryId.get(i.category) ?? null, brandId: brandId.get(i.brand) ?? null,
        itemGroupId: itemGroupId.get(i.group) ?? null, series: i.series, gstRate: i.gstRate, salePrice: i.sale, purchasePrice: i.purchase,
        mrp: i.mrp, listPrice: i.listPrice, wholesalePrice: i.wholesale, wholesaleMinQty: i.wholesaleMinQty, minStock: i.minStock, location: i.location,
      })),
    });

    /* godowns: the shop's default becomes the backup's default; others are added */
    const mainGodown = await tx.godown.findFirstOrThrow({ where: { isDefault: true } });
    for (const g of plan.godowns) {
      if (g.isDefault) await tx.godown.update({ where: { id: mainGodown.id }, data: { name: g.name, address: g.address, manager: g.manager, phone: g.phone } });
      else if (!(await tx.godown.findFirst({ where: { name: { equals: g.name, mode: 'insensitive' }, archivedAt: null } }))) await tx.godown.create({ data: { ...base, name: g.name, address: g.address, manager: g.manager, phone: g.phone } });
    }
    await tx.stockMovement.createMany({
      data: plan.items.flatMap((i) => i.opening.map((o) => ({
        ...base, itemId: itemId.get(i.legacyId)!, godownId: mainGodown.id, date: day(o.date), qty: o.qty, rate: o.rate, kind: 'opening', sourceType: 'import', note: 'Opening stock (imported)',
      }))),
    });

    /* price lists, their party groups, fixed prices */
    const lists = await tx.priceList.findMany();
    for (const pl of plan.priceLists) {
      const hit = lists.find((x) => x.legacyId === pl.legacyId) ?? lists.find((x) => x.name === pl.name);
      const data = { name: pl.name, isDefault: pl.isDefault, rule: pl.rule, value: pl.value, roundTo: pl.roundTo, active: pl.active, legacyId: pl.legacyId };
      const row = hit ? await tx.priceList.update({ where: { id: hit.id }, data }) : await tx.priceList.create({ data: { ...base, ...data } });
      await tx.priceListRule.deleteMany({ where: { priceListId: row.id } });
      const gids = pl.groups.map((g) => groupId.get(g)).filter((x): x is string => !!x);
      if (gids.length) await tx.priceListRule.createMany({ data: gids.map((partyGroupId) => ({ ...base, priceListId: row.id, partyGroupId })) });
      if (pl.overrides.length) await tx.itemPrice.createMany({ data: pl.overrides.map((o) => ({ ...base, priceListId: row.id, itemId: itemId.get(o.itemLegacyId)!, price: o.price })) });
    }

    /* price history, with the old app's dates */
    const listIds = new Map((await tx.priceList.findMany()).map((l) => [l.legacyId, l.id]));
    await tx.priceHistory.createMany({
      data: plan.priceHistory.flatMap((h) => {
        const field = h.field.startsWith('pl:') ? (listIds.get(h.field.slice(3)) ? `pl:${listIds.get(h.field.slice(3))}` : null) : h.field;
        return field ? [{ ...base, itemId: itemId.get(h.itemLegacyId)!, field, oldValue: h.oldValue, newValue: h.newValue, how: h.how, createdAt: new Date(h.at) }] : [];
      }),
    });

    /* electricians and commission */
    await tx.referrer.createMany({
      data: plan.referrers.map((r) => ({ ...base, legacyId: r.legacyId, name: r.name, phone: r.phone, city: r.city, partyId: partyId.get(r.partyLegacyId) ?? null })),
    });
    for (const c of plan.commission) {
      const cat = categoryId.get(c.category);
      if (!cat) continue;
      await tx.commissionRule.upsert({
        where: { businessId_categoryId: { businessId, categoryId: cat } },
        create: { ...base, categoryId: cat, kind: c.kind, value: c.value },
        update: { kind: c.kind, value: c.value },
      });
    }

    const run = await tx.importRun.create({
      data: { ...base, fileName: fileName.slice(0, 200), backupAt, status: 'done', counts: plan.counts, warnings: plan.warnings },
    });
    await this.audit.log(tx, { businessId, userId: actor.userId, action: 'create', entity: 'import', entityId: run.id, after: { fileName, backupAt, counts: plan.counts }, ip: actor.ip });
    return run.id;
  }

  list(actor: Pick<ImportActor, 'userId' | 'email' | 'businessId'>) {
    return this.db.scoped({ businessId: actor.businessId, userId: actor.userId, email: actor.email }, (tx) => tx.importRun.findMany({ orderBy: { createdAt: 'desc' } }));
  }
}
