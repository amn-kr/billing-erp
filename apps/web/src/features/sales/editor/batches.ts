/**
 * Which batches the bill on screen uses (Features › batch_expiry): worked out from its lines each time it
 * is drawn, with the same rules the server checks (billAllocs), so nothing can get out of step. A saved
 * bill's own goods count as back in stock while it is edited.
 */
import { billAllocs, expiryState, money, type BatchAlloc, type BatchRow } from '@billing/shared';
import type { EditorData } from './data';
import type { Line, SI } from './state';

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
  return billAllocs(si.lines.map((l) => ({ itemId: lineItem(l), qty: Number(l.qty) > 0 ? String(l.qty) : 0, hand: l.batches })), rows, si.date);
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
