import { BadRequestException } from '@nestjs/common';
import type { Tx } from './db.service';

/**
 * Checks shared by the edits of expenses, cash / bank entries, stock adjustments and transfers
 * (group 3). The number of a saved record never changes: an edit that sends another one is refused.
 */
export function keepNumber(sent: string | undefined, saved: string, what: string) {
  if (sent && sent !== saved) throw new BadRequestException({ message: `The number of a saved ${what} can’t be changed. It stays ${saved}.`, field: 'number' });
}

/** One changed field of an edited record, as kept in its audit entry (after.changes) for the history window. */
export interface FieldChange { field: string; old: unknown; new: unknown }

/** A value as it is shown and compared: dates as YYYY-MM-DD, money and quantities as plain text. */
const plain = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object' && 'toFixed' in v && typeof (v as { toString: unknown }).toString === 'function') return String(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v ?? null;
};

/**
 * The fields an edit changed, old and new value of each, in the order given. Who made the edit and
 * when are the audit entry's own user and time. An edit that changed nothing listed gives [].
 */
export function fieldChanges(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): FieldChange[] {
  return fields.flatMap((field) => {
    const o = plain(before[field]), n = plain(after[field]);
    return JSON.stringify(o) === JSON.stringify(n) ? [] : [{ field, old: o, new: n }];
  });
}

/**
 * The bank account where an entry of this record is ticked in Reconciliation, or null. Such an
 * entry is not changed: its tick (and the matched statement) would no longer fit.
 */
export async function reconciledIn(tx: Tx, sourceType: string, sourceId: string): Promise<string | null> {
  return (await reconciledMap(tx, sourceType, [sourceId])).get(sourceId) ?? null;
}

/** For many records at once (a list): record id → bank account where one of its entries is ticked. */
export async function reconciledMap(tx: Tx, sourceType: string, sourceIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!sourceIds.length) return out;
  const recs = await tx.reconciliation.findMany({ select: { accountId: true, cleared: true } });
  const ticked = new Set(recs.flatMap((r) => (Array.isArray(r.cleared) ? (r.cleared as string[]).map((id) => `${r.accountId}:${id}`) : [])));
  if (!ticked.size) return out;
  const lines = await tx.journalLine.findMany({
    where: { entry: { sourceType, sourceId: { in: sourceIds }, cancelledAt: null }, account: { key: { startsWith: 'cb:' } } },
    select: { id: true, entry: { select: { sourceId: true } }, account: { select: { key: true } } },
  });
  const hit = lines.filter((l) => ticked.has(`${l.account.key.slice(3)}:${l.id}`));
  if (!hit.length) return out;
  const names = new Map((await tx.cashBankAccount.findMany({ where: { id: { in: hit.map((l) => l.account.key.slice(3)) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  for (const l of hit) if (!out.has(l.entry.sourceId)) out.set(l.entry.sourceId, names.get(l.account.key.slice(3)) ?? 'your bank');
  return out;
}

/** The plain message for an entry already ticked in Reconciliation. */
export const reconciledMessage = (bank: string) => `This entry is ticked in Reconciliation for ${bank}. Untick it there first, then change it.`;
