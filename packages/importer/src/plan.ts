/**
 * Step 2 of an import: turn a snapshot into rows for the new tables.
 * Pure (no database), so every rule here is unit-tested. The API writes the
 * plan in one transaction (apps/api/src/modules/imports).
 *
 * Money and quantities leave here as strings with fixed decimals (Decimal
 * maths from packages/shared), ready for numeric(14,2) / numeric(14,3).
 */
import { GSTIN_RE, money, STATE_CODES, toDb } from '@billing/shared';
import type { Snapshot, SnapshotItem, SnapshotParty } from './snapshot.ts';

const qty = (v: number) => money(v).toDecimalPlaces(3).toFixed(3);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface PlanParty {
  legacyId: string;
  name: string;
  kind: 'customer' | 'supplier';
  group: string;
  phone: string;
  email: string;
  gstin: string;
  gstType: string;
  stateCode: string;
  creditLimit: string | null;
  creditDays: number;
  opening: { amount: string; type: 'receive' | 'pay'; date: string } | null;
  billing: { line: string; city: string; pin: string; stateCode: string } | null;
  shipping: { line: string } | null;
  contacts: { label: string; value: string }[];
}

export interface PlanItem {
  legacyId: string;
  kind: 'goods' | 'service';
  name: string;
  code: string;
  hsn: string;
  unit: string;
  category: string;
  brand: string;
  group: string;
  series: string;
  gstRate: string;
  sale: string;
  purchase: string;
  mrp: string;
  listPrice: string;
  wholesale: string;
  wholesaleMinQty: string;
  minStock: string;
  location: string;
  opening: { qty: string; rate: string; date: string }[];
}

export interface ImportPlan {
  business: Snapshot['business'];
  settings: Record<string, unknown>;
  taxes: { legacyId: string; kind: 'GST' | 'TCS' | 'TDS'; name: string; rate: string; note: string; isOld: boolean }[];
  partyGroups: string[];
  units: string[];
  categories: string[];
  brands: string[];
  itemGroups: string[];
  parties: PlanParty[];
  items: PlanItem[];
  priceLists: {
    legacyId: string; name: string; isDefault: boolean; rule: 'base' | 'disc' | 'mark'; value: string; roundTo: string;
    active: boolean; groups: string[]; overrides: { itemLegacyId: string; price: string }[];
  }[];
  godowns: { name: string; address: string; manager: string; phone: string; isDefault: boolean }[];
  referrers: { legacyId: string; name: string; phone: string; city: string; partyLegacyId: string }[];
  commission: { category: string; kind: 'none' | 'percent' | 'fixed'; value: string }[];
  counts: Record<string, number>;
  /** Plain-language notes for the person importing, e.g. renamed duplicates. */
  warnings: string[];
}

export interface PlanOptions {
  /** Also import the prototype's built-in demo parties and items (normally left out). */
  includeSample?: boolean;
}

/** Makes names unique (case-insensitive) the way a person would: "Name (2)". */
function uniqueNamer(what: string, warnings: string[]) {
  const seen = new Set<string>();
  return (name: string) => {
    let n = name.trim() || `Unnamed ${what}`;
    if (seen.has(n.toLowerCase())) {
      let i = 2;
      while (seen.has(`${n} (${i})`.toLowerCase())) i++;
      warnings.push(`Two ${what}s were both called “${n}”. The second one is now “${n} (${i})”.`);
      n = `${n} (${i})`;
    }
    seen.add(n.toLowerCase());
    return n;
  };
}

function uniqueIds(rows: { id: string }[], what: string, warnings: string[]) {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = r.id || what;
    const c = seen.get(k) ?? 0;
    seen.set(k, c + 1);
    if (c > 0) {
      r.id = `${k}~${c + 1}`;
      warnings.push(`Two ${what}s shared the internal id ${k} (the old app gives the same id to entries made in the same instant). They are kept as separate ${what}s.`);
    }
  }
}

const KIND: Record<string, 'none' | 'percent' | 'fixed'> = { n: 'none', p: 'percent', f: 'fixed' };
const RULES = new Set(['base', 'disc', 'mark']);

export function planImport(snap: Snapshot, opts: PlanOptions = {}): ImportPlan {
  const warnings: string[] = [];
  const keepSample = !!opts.includeSample;
  const keepItem = (i: SnapshotItem) => !i.sample || keepSample || snap.backup.keptSampleItems;
  const keepParty = (p: SnapshotParty) => !p.sample || keepSample;

  const srcParties = snap.parties.filter(keepParty).map((p) => ({ ...p }));
  const srcItems = snap.items.filter(keepItem).map((i) => ({ ...i }));
  const skippedParties = snap.parties.length - srcParties.length;
  const skippedItems = snap.items.length - srcItems.length;
  if (skippedParties || skippedItems)
    warnings.push(`Left out the old app’s demo data: ${skippedParties} sample parties and ${skippedItems} sample items. Ask if your shop used them for real.`);
  uniqueIds(srcParties, 'party', warnings);
  uniqueIds(srcItems, 'item', warnings);

  /* parties */
  const partyName = uniqueNamer('party', warnings);
  const groups = new Set<string>(snap.partyGroups);
  const parties: PlanParty[] = srcParties.map((p) => {
    const gstin = p.gstin.trim().toUpperCase();
    if (gstin && !GSTIN_RE.test(gstin)) warnings.push(`${p.name}: the GSTIN “${gstin}” doesn’t look right. It was kept as typed; please check it.`);
    groups.add(p.group || 'General');
    const opening = p.opening && p.opening.amount > 0
      ? { amount: toDb(p.opening.amount), type: p.opening.kind, date: ISO.test(p.opening.date) ? p.opening.date : snap.backup.at.slice(0, 10) }
      : null;
    if (p.opening && p.opening.amount < 0) warnings.push(`${p.name}: a negative opening balance (${p.opening.amount}) was left out. Please enter it again.`);
    const b = p.billing;
    const state = STATE_CODES.includes(p.state) ? p.state : gstin.slice(0, 2) && STATE_CODES.includes(gstin.slice(0, 2)) ? gstin.slice(0, 2) : '';
    return {
      legacyId: p.id,
      name: partyName(p.name),
      kind: p.role === 's' ? 'supplier' : 'customer',
      group: p.group || 'General',
      phone: p.phone.replace(/\s/g, ''),
      email: p.email.trim(),
      gstin,
      gstType: p.gstType,
      stateCode: state,
      creditLimit: p.creditLimit > 0 ? toDb(p.creditLimit) : null,
      creditDays: Math.max(0, Math.round(p.creditDays)),
      opening,
      billing: b.line || b.city || b.pin || b.state ? { line: b.line, city: b.city, pin: b.pin, stateCode: STATE_CODES.includes(b.state) ? b.state : '' } : null,
      shipping: p.shipping && p.shipping !== 'same' ? { line: p.shipping } : null,
      contacts: p.extra.filter((x) => x.value.trim()).map((x) => ({ label: x.field, value: x.value.trim() })),
    };
  });

  /* items */
  const itemName = uniqueNamer('item', warnings);
  const codes = new Set<string>();
  const units = new Set<string>(snap.units);
  const categories = new Set<string>(snap.categories);
  const brands = new Set<string>(snap.brands);
  const itemGroups = new Set<string>();
  let stockLater = 0;
  const items: PlanItem[] = srcItems.map((i) => {
    let code = i.code.trim();
    if (code && codes.has(code.toLowerCase())) {
      warnings.push(`Item code “${code}” was used twice. “${i.name}” keeps no code; please give it a new one.`);
      code = '';
    }
    if (code) codes.add(code.toLowerCase());
    const unit = (i.unit || 'PCS').trim().toUpperCase();
    units.add(unit);
    if (i.category) categories.add(i.category);
    if (i.brand) brands.add(i.brand);
    if (i.group) itemGroups.add(i.group);
    const opening = i.service ? [] : i.opening.filter((o) => o.qty !== 0).map((o) => ({ qty: qty(o.qty), rate: toDb(o.price), date: ISO.test(o.date) ? o.date : snap.backup.at.slice(0, 10) }));
    const openingQty = opening.reduce((a, o) => a.plus(o.qty), money(0));
    if (i.stock !== null && !money(i.stock).equals(openingQty)) stockLater++;
    return {
      legacyId: i.id, kind: i.service ? 'service' : 'goods', name: itemName(i.name), code, hsn: i.hsn.trim(), unit,
      category: i.category, brand: i.brand, group: i.group, series: i.series, gstRate: money(i.gst).toFixed(2),
      sale: toDb(i.sale), purchase: toDb(i.purchase), mrp: toDb(i.mrp), listPrice: toDb(i.listPrice), wholesale: toDb(i.wholesale),
      wholesaleMinQty: qty(i.wholesaleQty), minStock: qty(i.minStock), location: i.location, opening,
    };
  });
  if (stockLater)
    warnings.push(`${stockLater} items have stock changes from sales or purchases. Their opening stock is imported now; the changes come with the sales and purchases import (Phase 3).`);
  const images = srcItems.filter((i) => i.hasImage).length;
  if (images) warnings.push(`${images} item photos were not imported yet. They will move with file storage.`);

  /* price lists */
  const itemIds = new Set(srcItems.map((i) => i.id));
  let ignoredFixed = 0;
  const priceLists = snap.priceLists.map((pl) => {
    const overrides = Object.entries(pl.overrides).filter(([id]) => {
      const ok = itemIds.has(id);
      if (!ok) ignoredFixed++;
      return ok;
    }).map(([itemLegacyId, price]) => ({ itemLegacyId, price: toDb(price) }));
    for (const g of pl.groups) groups.add(g);
    return {
      legacyId: pl.id, name: pl.name, isDefault: pl.isDefault, rule: (RULES.has(pl.rule) ? pl.rule : 'base') as 'base' | 'disc' | 'mark',
      value: money(pl.value).toFixed(3), roundTo: toDb(pl.round), active: pl.isDefault || pl.active, groups: [...pl.groups], overrides,
    };
  });
  // The prototype ships fixed prices for its demo items; in a fresh shop nobody set those, so say nothing.
  if (ignoredFixed && !snap.backup.fresh) warnings.push(`${ignoredFixed} fixed prices were for demo items that were left out.`);

  /* godowns, referrers, commission */
  const godowns = snap.godowns.map((g) => ({ name: g.name, address: g.addr, manager: g.manager, phone: g.phone.replace(/\D/g, '').slice(-10), isDefault: g.isDefault }));
  if (!godowns.some((g) => g.isDefault) && godowns[0]) godowns[0].isDefault = true;
  const partyIds = new Set(srcParties.map((p) => p.id));
  const referrers = snap.referrers.map((r) => ({ legacyId: r.id, name: r.name, phone: r.phone.replace(/\s/g, ''), city: r.city, partyLegacyId: partyIds.has(r.partyId) ? r.partyId : '' }));
  const commission = Object.entries(snap.commissionRules).map(([category, r]) => {
    categories.add(category);
    const kind = KIND[r.t] ?? 'none';
    if (!KIND[r.t]) warnings.push(`Commission for ${category} had an unknown type and is set to “No commission”.`);
    return { category, kind, value: toDb(kind === 'none' ? 0 : r.v) };
  });

  const taxes = snap.taxes.map((t) => ({
    legacyId: t.id, kind: (['GST', 'TCS', 'TDS'].includes(t.type) ? t.type : 'GST') as 'GST' | 'TCS' | 'TDS',
    name: t.name, rate: money(t.rate).toFixed(2), note: t.note, isOld: t.old,
  }));

  const plan: ImportPlan = {
    business: snap.business,
    settings: snap.settings,
    taxes,
    partyGroups: [...groups].filter(Boolean),
    units: [...units].filter(Boolean),
    categories: [...categories].filter(Boolean),
    brands: [...brands].filter(Boolean),
    itemGroups: [...itemGroups].filter(Boolean),
    parties, items, priceLists, godowns, referrers, commission,
    counts: {},
    warnings,
  };
  plan.counts = {
    parties: parties.length, customers: parties.filter((p) => p.kind === 'customer').length, suppliers: parties.filter((p) => p.kind === 'supplier').length,
    items: items.length, services: items.filter((i) => i.kind === 'service').length, openingStockRows: items.reduce((a, i) => a + i.opening.length, 0),
    partiesWithOpeningBalance: parties.filter((p) => p.opening).length, priceLists: priceLists.length,
    fixedPrices: priceLists.reduce((a, p) => a + p.overrides.length, 0), godowns: godowns.length, referrers: referrers.length,
    brands: plan.brands.length, categories: plan.categories.length, units: plan.units.length, partyGroups: plan.partyGroups.length,
  };
  return plan;
}
