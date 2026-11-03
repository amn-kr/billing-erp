/**
 * Which batches the bill on screen uses (Settings › Items › Batch No.): worked out from its lines each time it
 * is drawn, with the same rules the server checks (billAllocs), so nothing can get out of step. A saved
 * bill's own goods count as back in stock while it is edited.
 */
import { billAllocs, effectiveMrp, expiryState, isAboveMrp, loosePrice, money, ratePerUnit, type BatchAlloc, type BatchRow } from '@billing/shared';
import type { EditorData } from './data';
import { linePack, lineStock, type Line, type SI } from './state';

/** A tracked item's batches for this bill; undefined for anything else (a quotation, an untracked item). */
export function batchRowsFor(d: EditorData, si: SI, itemId: string | undefined): BatchRow[] | undefined {
  if (!d.batches || si.doc !== 'sale' || !itemId || !d.IT.find((i) => i.id === itemId)?.track) return undefined;
  const rows = (d.batches[itemId] ?? []).map((r) => ({ ...r }));
  for (const a of si.batchWas?.[itemId] ?? []) {
    const r = rows.find((x) => x.id === a.batchId);
    if (r) r.qty = money(r.qty).plus(a.qty).toFixed(3);
    else if (a.row) rows.push({ ...a.row, qty: a.qty });
  }
  return rows;
}

const lineItem = (l: Line) => l.item?.id ?? '';

/** One list of batches per line of the bill (null for lines without batches). */
export function saleAllocs(d: EditorData, si: SI): (BatchAlloc[] | null)[] {
  if (!d.batches || si.doc !== 'sale') return si.lines.map(() => null);
  const rows: Record<string, BatchRow[]> = {};
  for (const l of si.lines) { const r = batchRowsFor(d, si, l.item?.id); if (r) rows[lineItem(l)] = r; }
  return billAllocs(si.lines.map((l) => ({ itemId: lineItem(l), qty: lineStock(l) > 0 ? String(lineStock(l)) : 0, hand: l.batches })), rows, si.date);
}

export interface ExpiredPick { item: string; no: string; expiry: string; qty: string }
/** Expired batches this bill uses that it didn't use when it was saved: these ask "Sell anyway". */
export function expiredPicks(d: EditorData, si: SI, allocs: (BatchAlloc[] | null)[]): ExpiredPick[] {
  const had = new Map<string, number>();
  for (const list of Object.values(si.batchWas ?? {})) for (const a of list) if (a.batchId) had.set(a.batchId, (had.get(a.batchId) ?? 0) + Number(a.qty));
  const out: ExpiredPick[] = [];
  allocs.forEach((list, k) => {
    const l = si.lines[k]!;
    const rows = batchRowsFor(d, si, l.item?.id) ?? [];
    for (const a of list ?? []) {
      const r = rows.find((x) => x.id === a.batchId);
      if (!r?.id || !r.expiry || expiryState(r.expiry, si.date) !== 'expired') continue;
      const before = had.get(r.id) ?? 0, fresh = Number(a.qty) - before;
      had.set(r.id, Math.max(0, before - Number(a.qty)));
      if (fresh > 0.0005) out.push({ item: l.name, no: r.no, expiry: r.expiry, qty: fresh.toFixed(3) });
    }
  });
  return out;
}

/** Settings › Items › MRP and Pack: a line's MRP: the lowest of the batches it uses, else the item's. */
export function lineMrp(d: EditorData, si: SI, l: Line, allocs: BatchAlloc[] | null | undefined): number | null {
  if (!d.mrpOn || !l.item || l.item.svc || si.doc !== 'sale') return null;
  const rows = batchRowsFor(d, si, l.item.id) ?? [];
  const m = effectiveMrp(l.item.mrp ?? 0, (allocs ?? []).map((a) => rows.find((r) => r.id === a.batchId)?.mrp ?? null));
  return m ? m.toNumber() : null;
}

/** The MRP for the line's own unit: the MRP is per pack, so a loose unit's is the pack's ÷ its size. */
const unitMrp = (l: Line, mrp: number): number => (l.item?.pack && !linePack(l) ? loosePrice(mrp, l.item.pack.size).toNumber() : mrp);
/** The line's rate is above the MRP for its unit. */
export function lineOverMrp(d: EditorData, si: SI, l: Line, allocs: BatchAlloc[] | null | undefined, amt: number): boolean {
  const mrp = lineMrp(d, si, l, allocs);
  return !!mrp && isAboveMrp(amt, Number(l.qty) || 0, money(unitMrp(l, mrp)));
}

export interface AboveMrp { item: string; rate: number; mrp: number; unit: string }
/** Lines above their MRP that need "Save anyway": what the saved bill already sold at that rate or higher isn't asked again. */
export function aboveMrpPicks(d: EditorData, si: SI, allocs: (BatchAlloc[] | null)[], amts: number[]): AboveMrp[] {
  return si.lines.flatMap((l, k) => {
    const mrp = lineMrp(d, si, l, allocs[k]);
    const amt = amts[k] ?? 0;
    if (!mrp || !lineOverMrp(d, si, l, allocs[k], amt)) return [];
    const rate = ratePerUnit(amt, Number(l.qty)).toNumber();
    // what the saved bill sold is compared per stock unit, so a change of unit can't hide or repeat the question
    return (si.mrpWas?.[l.item!.id] ?? -1) >= ratePerUnit(amt, lineStock(l)).toNumber() ? [] : [{ item: l.name, rate, mrp: unitMrp(l, mrp), unit: l.unit }];
  });
}
