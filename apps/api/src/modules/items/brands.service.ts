import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { money, type BrandInput, type BrandUpdate, type SeriesInput, type SeriesUpdate } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { stockByItem } from './items.service';

/** Item names made by Add item for a variant: "Parent · Brand Series" (AddItemDialog vname). */
const vname = (g: string, b: string, s: string) => `${g} · ${b}${s ? ' ' + s : ''}`;
const key = (brandId: string, name: string) => `${brandId}|${name.trim().toLowerCase()}`;
const q3 = (v: { toString(): string }) => money(v.toString()).toDecimalPlaces(3).toFixed(3);

/**
 * A stable id for a series typed only on items (from its brand and name), so a saved quotation keeps its
 * column; the brand_series row made the first time the series is changed gets the same id. A name used
 * again after a rename gets the next free id.
 */
export function itemSeriesId(brandId: string, name: string, taken: Set<string>): string {
  for (let n = 0; ; n++) {
    const h = createHash('sha1').update(`${brandId}|${name.trim().toLowerCase()}${n ? '#' + n : ''}`).digest('hex');
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
    if (!taken.has(id)) return id;
  }
}

interface Stat { items: number; stock: ReturnType<typeof money>; value: ReturnType<typeof money>; updated: Date }

/**
 * Brands & Series (Items › Brands & Series). A brand is the brands row; a series is either a
 * brand_series row (added here) or a series typed on items of that brand (items.series), matched by
 * name ignoring capital letters. Nothing is ever deleted: brands and series are made inactive.
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /** Live items with their stock, grouped per brand and per brand + series. */
  private async stats(tx: Tx) {
    const items = await tx.item.findMany({ where: { archivedAt: null, brandId: { not: null } }, select: { id: true, kind: true, brandId: true, series: true, purchasePrice: true, updatedAt: true } });
    const stock = await stockByItem(tx, items.map((i) => i.id));
    const byBrand = new Map<string, Stat>(), bySeries = new Map<string, Stat & { name: string; brandId: string }>();
    const add = (s: Stat, i: (typeof items)[number]) => {
      s.items++;
      if (i.updatedAt > s.updated) s.updated = i.updatedAt;
      if (i.kind !== 'goods') return;
      const q = money((stock.get(i.id) ?? 0).toString());
      s.stock = s.stock.plus(q);
      s.value = s.value.plus(money(Math.max(0, q.toNumber())).times(i.purchasePrice.toString()));
    };
    const empty = (): Stat => ({ items: 0, stock: money(0), value: money(0), updated: new Date(0) });
    for (const i of items) {
      const b = i.brandId!;
      if (!byBrand.has(b)) byBrand.set(b, empty());
      add(byBrand.get(b)!, i);
      if (!i.series.trim()) continue;
      const k = key(b, i.series);
      if (!bySeries.has(k)) bySeries.set(k, { ...empty(), name: i.series.trim(), brandId: b });
      add(bySeries.get(k)!, i);
    }
    return { byBrand, bySeries };
  }

  private async seriesList(tx: Tx) {
    const [brands, rows, { bySeries }] = await Promise.all([tx.brand.findMany(), tx.brandSeries.findMany({ orderBy: { createdAt: 'asc' } }), this.stats(tx)]);
    const brandName = new Map(brands.map((b) => [b.id, b.name]));
    const brandActive = new Set(brands.filter((b) => !b.archivedAt).map((b) => b.id));
    const rowIds = new Set(rows.map((r) => r.id));
    const out = rows.map((r) => {
      const s = bySeries.get(key(r.brandId, r.name));
      return { id: r.id as string | null, key: r.id, brandActive: brandActive.has(r.brandId), brandId: r.brandId, brand: brandName.get(r.brandId) ?? '', name: r.name, size: r.size, notes: r.notes, items: s?.items ?? 0, stock: q3(s?.stock ?? 0), value: (s?.value ?? money(0)).toFixed(2), active: !r.archivedAt, updatedAt: new Date(Math.max(r.updatedAt.getTime(), s?.updated.getTime() ?? 0)) };
    });
    const saved = new Set(rows.map((r) => key(r.brandId, r.name)));
    for (const [k, s] of bySeries) {
      if (saved.has(k)) continue;
      // typed on items only: shown like the others, saved here the first time it is changed
      out.push({ id: null, key: itemSeriesId(s.brandId, s.name, rowIds), brandActive: brandActive.has(s.brandId), brandId: s.brandId, brand: brandName.get(s.brandId) ?? '', name: s.name, size: '', notes: '', items: s.items, stock: q3(s.stock), value: s.value.toFixed(2), active: true, updatedAt: s.updated });
    }
    return out.sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  }

  brands(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const [brands, { byBrand }, series] = await Promise.all([tx.brand.findMany({ orderBy: { name: 'asc' } }), this.stats(tx), this.seriesList(tx)]);
      return brands.map((b) => {
        const s = byBrand.get(b.id);
        const mine = series.filter((x) => x.brandId === b.id);
        const updated = Math.max(b.updatedAt.getTime(), s?.updated.getTime() ?? 0, ...mine.map((x) => x.updatedAt.getTime()));
        return { id: b.id, name: b.name, notes: b.notes, series: mine.length, items: s?.items ?? 0, stock: q3(s?.stock ?? 0), value: (s?.value ?? money(0)).toFixed(2), active: !b.archivedAt, updatedAt: new Date(updated) };
      });
    });
  }

  series(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), (tx) => this.seriesList(tx));
  }

  /** Every series with its stable id (key) and whether it and its brand are active, for the Quotation columns. */
  seriesForQuotes(tx: Tx) {
    return this.seriesList(tx);
  }

  private async brandClash(tx: Tx, name: string, exceptId?: string) {
    if (await tx.brand.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) } }))
      throw new ConflictException({ message: `A brand called ${name} already exists.`, field: 'name' });
  }

  addBrand(ctx: RequestContext, input: BrandInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      await this.brandClash(tx, input.name);
      const b = await tx.brand.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, name: input.name, notes: input.notes } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'brand', entityId: b.id, after: { name: b.name, notes: b.notes }, ip: ctx.ip });
      return { id: b.id, name: b.name };
    });
  }

  /** Rename (items made by Add item, "Parent · Brand Series", get the new brand in their name), notes, or active / inactive. */
  updateBrand(ctx: RequestContext, id: string, input: BrandUpdate) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const b = await tx.brand.findFirst({ where: { id } });
      if (!b) throw new NotFoundException({ message: 'That brand was not found.' });
      const name = input.name ?? b.name;
      if (name !== b.name) await this.brandClash(tx, name, id);
      const after = await tx.brand.update({
        where: { id },
        data: { name, ...(input.notes !== undefined && { notes: input.notes }), ...(input.active !== undefined && { archivedAt: input.active ? null : (b.archivedAt ?? new Date()) }) },
      });
      if (name !== b.name) {
        const items = await tx.item.findMany({ where: { brandId: id, itemGroupId: { not: null } }, include: { itemGroup: true } });
        await this.renameItems(tx, ctx, items.map((i) => ({ id: i.id, name: i.name, from: vname(i.itemGroup!.name, b.name, i.series), to: vname(i.itemGroup!.name, name, i.series) })));
      }
      await this.audit.log(tx, {
        businessId: ctx.businessId!, userId: ctx.userId, action: input.active === false && !b.archivedAt ? 'cancel' : 'update', entity: 'brand', entityId: id,
        before: { name: b.name, notes: b.notes, active: !b.archivedAt }, after: { name: after.name, notes: after.notes, active: !after.archivedAt }, ip: ctx.ip,
      });
      return { id, name: after.name };
    });
  }

  /** Item names that still read exactly as Add item made them follow a rename; names typed by hand are left alone. */
  private async renameItems(tx: Tx, ctx: RequestContext, list: { id: string; name: string; from: string; to: string }[]) {
    for (const i of list) {
      if (i.name !== i.from || i.from === i.to) continue;
      if (await tx.item.findFirst({ where: { archivedAt: null, id: { not: i.id }, name: { equals: i.to, mode: 'insensitive' } } }))
        throw new ConflictException({ message: `An item called ${i.to} already exists. Rename that item first.` });
      await tx.item.update({ where: { id: i.id }, data: { name: i.to } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'item', entityId: i.id, before: { name: i.from }, after: { name: i.to }, ip: ctx.ip });
    }
  }

  private async liveBrand(tx: Tx, brandId: string) {
    const b = await tx.brand.findFirst({ where: { id: brandId } });
    if (!b) throw new BadRequestException({ message: 'Choose a brand.', field: 'brand' });
    return b;
  }

  /** A series name is new within its brand: not saved here and not typed on that brand's items. */
  private async seriesClash(tx: Tx, brandId: string, brand: string, name: string, exceptId?: string) {
    const same = { equals: name.trim(), mode: 'insensitive' as const };
    const taken = (await tx.brandSeries.findFirst({ where: { brandId, name: same, ...(exceptId ? { id: { not: exceptId } } : {}) } }))
      || (await tx.item.findFirst({ where: { archivedAt: null, brandId, series: same } }));
    if (taken) throw new ConflictException({ message: `${brand} already has a series called ${name.trim()}.`, field: 'name' });
  }

  addSeries(ctx: RequestContext, input: SeriesInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const b = await this.liveBrand(tx, input.brandId);
      await this.seriesClash(tx, b.id, b.name, input.name);
      const s = await tx.brandSeries.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, brandId: b.id, name: input.name, size: input.size, notes: input.notes } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'brand_series', entityId: s.id, after: { brand: b.name, name: s.name, size: s.size, notes: s.notes }, ip: ctx.ip });
      return { id: s.id, name: s.name };
    });
  }

  /**
   * Rename, change brand, size / notes, or active / inactive. A series typed only on items is saved
   * here first. Its items move with it: their series (and brand) change, and names made by Add item follow.
   */
  updateSeries(ctx: RequestContext, ref: { id?: string; brandId?: string; name?: string }, input: SeriesUpdate) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      let row = ref.id ? await tx.brandSeries.findFirst({ where: { id: ref.id } }) : null;
      if (!row && !ref.id && ref.brandId && ref.name) {
        const fromBrand = await this.liveBrand(tx, ref.brandId);
        row = await tx.brandSeries.findFirst({ where: { brandId: ref.brandId, name: { equals: ref.name.trim(), mode: 'insensitive' } } });
        if (!row) {
          if (!(await tx.item.findFirst({ where: { archivedAt: null, brandId: ref.brandId, series: { equals: ref.name.trim(), mode: 'insensitive' } } }))) throw new NotFoundException({ message: 'That series was not found.' });
          const taken = new Set((await tx.brandSeries.findMany({ select: { id: true } })).map((x) => x.id));
          row = await tx.brandSeries.create({ data: { id: itemSeriesId(ref.brandId, ref.name, taken), businessId: ctx.businessId!, createdBy: ctx.userId, brandId: ref.brandId, name: ref.name.trim() } });
          await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'brand_series', entityId: row.id, after: { brand: fromBrand.name, name: row.name, from: 'items' }, ip: ctx.ip });
        }
      }
      if (!row) throw new NotFoundException({ message: 'That series was not found.' });
      const oldBrand = await this.liveBrand(tx, row.brandId);
      const newBrand = input.brandId && input.brandId !== row.brandId ? await this.liveBrand(tx, input.brandId) : oldBrand;
      const name = input.name ?? row.name;
      const moved = newBrand.id !== oldBrand.id, renamed = name !== row.name;
      if (moved || name.toLowerCase() !== row.name.toLowerCase()) await this.seriesClash(tx, newBrand.id, newBrand.name, name, row.id);
      const after = await tx.brandSeries.update({
        where: { id: row.id },
        data: {
          brandId: newBrand.id, name,
          ...(input.size !== undefined && { size: input.size }), ...(input.notes !== undefined && { notes: input.notes }),
          ...(input.active !== undefined && { archivedAt: input.active ? null : (row.archivedAt ?? new Date()) }),
        },
      });
      if (moved || renamed) {
        const items = await tx.item.findMany({ where: { brandId: oldBrand.id, series: { equals: row.name, mode: 'insensitive' } }, include: { itemGroup: true } });
        for (const i of items) {
          await tx.item.update({ where: { id: i.id }, data: { series: name, brandId: newBrand.id } });
          await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'item', entityId: i.id, before: { brand: oldBrand.name, series: i.series }, after: { brand: newBrand.name, series: name }, ip: ctx.ip });
        }
        await this.renameItems(tx, ctx, items.filter((i) => i.itemGroup).map((i) => ({ id: i.id, name: i.name, from: vname(i.itemGroup!.name, oldBrand.name, i.series), to: vname(i.itemGroup!.name, newBrand.name, name) })));
      }
      await this.audit.log(tx, {
        businessId: ctx.businessId!, userId: ctx.userId, action: input.active === false && !row.archivedAt ? 'cancel' : 'update', entity: 'brand_series', entityId: row.id,
        before: { brand: oldBrand.name, name: row.name, size: row.size, notes: row.notes, active: !row.archivedAt },
        after: { brand: newBrand.name, name: after.name, size: after.size, notes: after.notes, active: !after.archivedAt }, ip: ctx.ip,
      });
      return { id: after.id, name: after.name };
    });
  }
}
