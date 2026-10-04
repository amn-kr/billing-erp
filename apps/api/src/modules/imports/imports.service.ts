import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extractSnapshot, ImportError, parseBackup, planImport, type ImportPlan, type PlanOptions } from '@billing/importer';
import type { Prisma } from '@prisma/client';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { LedgerService } from '../../common/ledger.service';
import { NumberingService } from '../../common/numbering.service';
import { writeSales } from './sales-import';
import { writePurchases } from './purchase-import';
import { writeAccounts, writeChequeStates, writeEntries } from './banking-import';
import { ChequesService } from '../banking/cheques.service';
import { writeExpenses } from './expense-import';
import { ExpensesService } from '../expenses/expenses.service';
import { BankingService } from '../banking/banking.service';
import { PurchasesService } from '../purchases/purchases.service';
import type { RequestContext } from '../../common/context';
import { setCashOpening, shortName } from '../businesses/businesses.service';

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
    private readonly ledger: LedgerService,
    private readonly numbers: NumberingService,
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
    if (req.dryRun) {
      // the check also says up front when the shop already has data (the import would refuse)
      const [parties, items] = await this.db.scoped({ businessId: actor.businessId, userId: actor.userId, email: actor.email }, (tx) => Promise.all([tx.party.count(), tx.item.count()]));
      if (parties || items) throw new ConflictException({ message: 'This shop already has parties or items. Import into a new, empty shop so nothing is entered twice.' });
      return { dryRun: true, importId: null, counts: plan.counts, warnings: plan.warnings };
    }
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
        stateCode: b.state || before.stateCode, gstin: b.gstin, ...(b.email && { email: b.email }),
      },
    });
    if (b.owner) await tx.membership.updateMany({ where: { userId: before.ownerId }, data: { displayName: b.owner } });
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
    // rates the old app's tax list no longer had were deleted there: switch them off here
    if (plan.taxes.length) await tx.taxRate.updateMany({ where: { legacyId: { notIn: plan.taxes.map((t) => t.legacyId) } }, data: { active: false } });

    /* the old app's Settings switches, under the names the new screens use */
    {
      const o = plan.settings as Record<string, unknown>;
      const ids = new Map((await tx.taxRate.findMany({ where: { active: true } })).map((t) => [t.legacyId, t.id]));
      const pick: Record<string, unknown> = {};
      for (const k of ['reg', 'hsn', 'pos', 'rcm', 'cess', 'tcs', 'tds', 'tdsBill', 'tdsExp', 'payQr', 'waLink', 'acct', 'upiName']) if (o[k] !== undefined && o[k] !== null && typeof o[k] !== 'object') pick[k] = o[k];
      if (typeof o.curSym === 'boolean') pick.showCurrency = o.curSym;
      if (typeof o.showMrp === 'boolean') pick.mrp = o.showMrp;
      if (b.cashOpen > 0) { pick.cashOpen = String(b.cashOpen); await setCashOpening(tx, String(b.cashOpen)); }
      for (const k of ['tcsRate', 'tdsRate']) if (typeof o[k] === 'string' && ids.get(o[k] as string)) pick[k] = ids.get(o[k] as string);
      const cur = await tx.businessSettings.findUniqueOrThrow({ where: { businessId } });
      await tx.businessSettings.update({ where: { businessId }, data: { data: { ...(cur.data as object), ...pick } as Prisma.InputJsonValue } });
    }

    /* simple lists */
    const ensure = async <K extends 'partyGroup' | 'category' | 'brand' | 'itemGroup'>(model: K, names: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = tx[model] as any;
      const t0 = Date.now(); // a millisecond apart: the old app's list order is kept
      await m.createMany({ data: names.map((name: string, k: number) => ({ ...base, name, createdAt: new Date(t0 + k) })), skipDuplicates: true });
      const rows: { id: string; name: string }[] = await m.findMany({ select: { id: true, name: true } });
      return new Map(rows.map((r) => [r.name, r.id]));
    };
    const groupId = await ensure('partyGroup', plan.partyGroups);
    const categoryId = await ensure('category', plan.categories);
    const brandId = await ensure('brand', plan.brands);
    const itemGroupId = await ensure('itemGroup', plan.itemGroups);
    { const t0 = Date.now(); await tx.unit.createMany({ data: plan.units.map((code, k) => ({ ...base, code, createdAt: new Date(t0 + k) })), skipDuplicates: true }); }
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
      // the old app lists items newest first; keep that order
      data: plan.items.map((i, k) => ({
        ...base, id: itemId.get(i.legacyId)!, createdAt: new Date(Date.parse(backupAt || new Date().toISOString()) - k * 1000), legacyId: i.legacyId, kind: i.kind, name: i.name, code: i.code, hsn: i.hsn,
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

    /* brand / series price rules: their price-list fields point at the new lists (rules for unknown lists are dropped) */
    if (Object.keys(plan.priceRules).length) {
      const rules = Object.fromEntries(Object.entries(plan.priceRules).map(([k, r]) => [k, Object.fromEntries(Object.entries(r as Record<string, unknown>).flatMap(([f, x]) => {
        if (!f.startsWith('pl:')) return [[f, x]];
        const id = listIds.get(f.slice(3));
        return id ? [[`pl:${id}`, x]] : [];
      }))]));
      const cur = await tx.businessSettings.findUniqueOrThrow({ where: { businessId } });
      await tx.businessSettings.update({ where: { businessId }, data: { data: { ...(cur.data as object), priceRules: rules } as Prisma.InputJsonValue } });
    }

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

    /* cash and bank accounts first: money in the documents below lands in them */
    const pctx = { businessId, userId: actor.userId, email: '', ip: actor.ip } as RequestContext;
    const acctIds = await writeAccounts(tx, pctx, plan.banking);

    /* sales documents (invoices, payments, credit notes, challans, quotations) */
    const referrerId = new Map((await tx.referrer.findMany({ where: { legacyId: { not: null } } })).map((r) => [r.legacyId!, r.id]));
    await writeSales(tx, { businessId, userId: actor.userId, partyId, itemId, referrerId, ledger: this.ledger, numbers: this.numbers, warnings: plan.warnings }, plan.sales);

    /* purchases (bills, orders, debit notes, payments made), through the same rules as new ones */
    await writePurchases(tx, pctx, new PurchasesService(this.db, this.audit, this.numbers, this.ledger), { partyId, itemId, warnings: plan.warnings }, plan.purchases);

    /* money moved by hand between cash and bank */
    await writeEntries(tx, pctx, new BankingService(this.db, this.audit, this.numbers, this.ledger), plan.banking, acctIds);

    /* expense categories and expenses */
    await writeExpenses(tx, pctx, new ExpensesService(this.db, this.audit, this.numbers, this.ledger), plan.expenses, acctIds);

    /* cheques the old app marked deposited / cleared or bounced */
    await writeChequeStates(tx, pctx, new ChequesService(this.db, this.audit, this.ledger), plan.banking, acctIds, plan.warnings);

    const run = await tx.importRun.create({
      data: { ...base, fileName: fileName.slice(0, 200), backupAt, status: 'done', counts: plan.counts, warnings: plan.warnings },
    });
    await this.audit.log(tx, { businessId, userId: actor.userId, action: 'create', entity: 'import', entityId: run.id, after: { fileName, backupAt, counts: plan.counts }, ip: actor.ip });
    return run.id;
  }

  list(actor: Pick<ImportActor, 'userId' | 'email' | 'businessId'>) {
    return this.db.scoped({ businessId: actor.businessId, userId: actor.userId, email: actor.email }, (tx) => tx.importRun.findMany({ orderBy: { createdAt: 'desc' } }));
  }

  /**
   * Settings › Download backup: this shop's books as one JSON file (format
   * "billing-erp-cloud" v2). Secrets (price PIN, sign-in data) are never included.
   */
  backup(ctx: { userId: string; email: string; businessId: string }) {
    return this.db.scoped(ctx, async (tx) => {
      const b = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
      const data = {
        business: { name: b.name, shortName: b.shortName, code: b.code, phone: b.phone, email: b.email, address: b.address, city: b.city, pin: b.pin, stateCode: b.stateCode, gstin: b.gstin },
        settings: await tx.businessSettings.findUnique({ where: { businessId: ctx.businessId } }),
        taxRates: await tx.taxRate.findMany(), series: await tx.documentSeries.findMany(),
        partyGroups: await tx.partyGroup.findMany(), parties: await tx.party.findMany(), partyAddresses: await tx.partyAddress.findMany(), partyContacts: await tx.partyContact.findMany(),
        units: await tx.unit.findMany(), categories: await tx.category.findMany(), brands: await tx.brand.findMany(), itemGroups: await tx.itemGroup.findMany(), items: await tx.item.findMany(),
        godowns: await tx.godown.findMany(), stockMovements: await tx.stockMovement.findMany(), stockAdjustments: await tx.stockAdjustment.findMany(), stockTransfers: await tx.stockTransfer.findMany(),
        priceLists: await tx.priceList.findMany(), priceListRules: await tx.priceListRule.findMany(), itemPrices: await tx.itemPrice.findMany(), priceHistory: await tx.priceHistory.findMany(),
        referrers: await tx.referrer.findMany(), commissionRules: await tx.commissionRule.findMany(),
      };
      const counts = Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
      return { app: 'billing-erp-cloud', v: 2, at: new Date().toISOString(), biz: b.name, counts, data };
    }, { timeout: 60_000 });
  }
}
