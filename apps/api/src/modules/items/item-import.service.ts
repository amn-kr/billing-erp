import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { checkImportRows, rowProblems, type ImportContext, type ImportItem, type ImportRowsInput, type ImportSummary, type RowCheck } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { day, unitIdFor } from '../../common/lookups';
import { planToday } from '../../config';

const low = (s: string) => s.trim().toLowerCase();
/** rows saved per insert */
const CHUNK = 500;
const chunks = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));

export type ImportResult = { done: true; summary: ImportSummary } | { done: false; message: string; checks: RowCheck[] };

/**
 * Items › Import products. Rows are checked in the browser while they are edited; Final import
 * checks them again here against the shop as it is now, and saves everything in one transaction.
 */
@Injectable()
export class ItemImportService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /** What the shop has now: live items, brands, series, parent items, units, godowns, categories and GST rates. */
  private async load(tx: Tx): Promise<ImportContext> {
    const [items, brands, series, groups, units, godowns, categories, taxes] = await Promise.all([
      tx.item.findMany({ where: { archivedAt: null }, select: { name: true, code: true, series: true, brand: { select: { name: true } }, itemGroup: { select: { name: true } } } }),
      tx.brand.findMany({ select: { id: true, name: true, archivedAt: true } }),
      tx.brandSeries.findMany({ select: { brandId: true, name: true, archivedAt: true } }),
      tx.itemGroup.findMany({ select: { name: true } }),
      tx.unit.findMany({ where: { archivedAt: null }, select: { code: true, name: true }, orderBy: { createdAt: 'asc' } }),
      tx.godown.findMany({ where: { archivedAt: null }, select: { name: true, isDefault: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      tx.category.findMany({ select: { name: true }, orderBy: { createdAt: 'asc' } }),
      tx.taxRate.findMany({ where: { kind: 'GST', active: true }, select: { rate: true }, orderBy: { rate: 'asc' } }),
    ]);
    const brandName = new Map(brands.map((b) => [b.id, b.name]));
    return {
      // India's date (a fixed date under tests, so pictures do not change from day to day)
      today: planToday(),
      items: items.map((i) => ({ name: i.name, code: i.code, group: i.itemGroup?.name ?? '', brand: i.brand?.name ?? '', series: i.series })),
      brands: brands.map((b) => ({ name: b.name, active: !b.archivedAt })),
      series: series.map((s) => ({ brand: brandName.get(s.brandId) ?? '', name: s.name, active: !s.archivedAt })),
      groups: groups.map((g) => g.name),
      units,
      godowns,
      categories: categories.map((c) => c.name),
      gstRates: [...new Set(taxes.map((t) => t.rate.toString()))],
    };
  }

  context(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), (tx) => this.load(tx));
  }

  /** Final import: all rows or none. With skipErrors, rows that still have errors are left out and listed. */
  run(ctx: RequestContext, input: ImportRowsInput): Promise<ImportResult> {
    const b = ctx.businessId!, u = ctx.userId;
    return this.db.scoped(this.scope(ctx), async (tx) => {
      // one import per shop at a time, so two imports cannot both add the same name or code
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item-import:' + b}))`;
      const shop = await this.load(tx);
      const checks = checkImportRows(input.rows, shop);
      const bad = checks.filter((c) => c.status === 'error');
      if (bad.length && !input.skipErrors)
        return { done: false, message: `${bad.length} ${bad.length === 1 ? 'row has' : 'rows have'} errors. Fix them or tick “Skip error rows”. Nothing was imported.`, checks };
      const rows = checks.flatMap((c) => (c.item ? [c.item] : []));
      if (!rows.length) return { done: false, message: 'There are no rows without errors to import. Nothing was imported.', checks };

      const firstOf = (pick: (i: ImportItem) => string | null) => [...new Map(rows.flatMap((i) => { const v = pick(i); return v ? [[low(v), v] as const] : []; })).values()];
      const audit = (entity: string, id: string, after: unknown) => ({ businessId: b, userId: u, action: 'create' as const, entity, entityId: id, after, ip: ctx.ip });
      const logs: Parameters<AuditService['logMany']>[1] = [];

      // new parent items, brands and categories (the names the rows already use)
      const ids = { group: new Map<string, string>(), brand: new Map<string, string>(), category: new Map<string, string>() };
      for (const g of await tx.itemGroup.findMany({ select: { id: true, name: true } })) ids.group.set(low(g.name), g.id);
      for (const x of await tx.brand.findMany({ select: { id: true, name: true } })) ids.brand.set(low(x.name), x.id);
      for (const x of await tx.category.findMany({ select: { id: true, name: true } })) ids.category.set(low(x.name), x.id);
      const newGroups = firstOf((i) => (i.newGroup ? i.group : null));
      const newBrands = firstOf((i) => (i.newBrand ? i.brand : null));
      const newCategories = firstOf((i) => (i.newCategory ? i.category : null));
      for (const [list, model, map, entity] of [
        [newGroups, 'itemGroup', ids.group, 'item_group'],
        [newBrands, 'brand', ids.brand, 'brand'],
        [newCategories, 'category', ids.category, 'category'],
      ] as const) {
        const made = list.map((name) => ({ id: randomUUID(), businessId: b, createdBy: u, name }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (made.length) await (tx[model] as any).createMany({ data: made });
        for (const m of made) { map.set(low(m.name), m.id); logs.push(audit(entity, m.id, { name: m.name, from: 'import' })); }
      }

      // new series on Brands & Series
      const newSeries = [...new Map(rows.filter((i) => i.newSeries).map((i) => [`${low(i.brand)}|${low(i.series)}`, i] as const)).values()];
      const seriesRows = newSeries.map((i) => ({ id: randomUUID(), businessId: b, createdBy: u, brandId: ids.brand.get(low(i.brand))!, name: i.series }));
      if (seriesRows.length) await tx.brandSeries.createMany({ data: seriesRows });
      seriesRows.forEach((s, n) => logs.push(audit('brand_series', s.id, { brand: newSeries[n]!.brand, name: s.name, from: 'import' })));

      // units and godowns (checked to exist; blank unit = PCS, blank godown = the main one)
      const unitIds = new Map<string, string>();
      for (const code of new Set(rows.map((i) => i.unit))) unitIds.set(code, (await unitIdFor(tx, b, u, code))!);
      const godowns = await tx.godown.findMany({ where: { archivedAt: null }, select: { id: true, name: true, isDefault: true } });
      const mainGodown = godowns.find((g) => g.isDefault) ?? godowns[0];
      const godownId = (name: string) => (name ? godowns.find((g) => low(g.name) === low(name))!.id : mainGodown!.id);

      const items = rows.map((i) => ({
        id: randomUUID(), businessId: b, createdBy: u, kind: 'goods', name: i.name, code: i.code, hsn: i.hsn,
        unitId: unitIds.get(i.unit)!, categoryId: i.category ? ids.category.get(low(i.category))! : null,
        brandId: i.brand ? ids.brand.get(low(i.brand))! : null, itemGroupId: i.kind === 'multi' ? ids.group.get(low(i.group))! : null,
        series: i.series, gstRate: i.gst, salePrice: i.sale, purchasePrice: i.rate ?? '0.00', minStock: i.minStock,
      }));
      for (const part of chunks(items)) await tx.item.createMany({ data: part });

      // opening stock, the same entry Add item makes (rate shows in the item's purchase-rate table)
      const moves = rows.flatMap((i, n) => {
        if (!i.qty) return [];
        if (!mainGodown && !i.godown) throw new Error('This shop has no godown.');
        return [{ businessId: b, createdBy: u, itemId: items[n]!.id, godownId: godownId(i.godown), date: day(i.date!), qty: i.qty, rate: i.rate ?? '0.00', kind: 'opening', note: 'Opening stock' }];
      });
      for (const part of chunks(moves)) await tx.stockMovement.createMany({ data: part });

      rows.forEach((i, n) => logs.push(audit('item', items[n]!.id, {
        name: i.name, kind: 'goods', code: i.code, brand: i.brand, group: i.group, series: i.series, unit: i.unit, category: i.category, hsn: i.hsn,
        gstRate: i.gst, sale: i.sale, purchase: i.rate ?? '0.00', minStock: i.minStock,
        opening: i.qty ? { qty: i.qty, rate: i.rate ?? '0.00', date: i.date, godown: i.godown || mainGodown!.name } : null, from: 'import', line: i.line,
      })));
      await this.audit.logMany(tx, logs);

      return {
        done: true,
        summary: {
          created: items.length,
          withStock: moves.length,
          skipped: bad.map((c) => ({ line: c.line, reasons: rowProblems(c, 'error') })),
          newBrands, newSeries: newSeries.map((i) => `${i.brand} ${i.series}`), newGroups, newCategories,
        },
      };
    }, { timeout: 120_000 });
  }
}
