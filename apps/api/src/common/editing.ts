import { BadRequestException } from '@nestjs/common';
import { money, type Money } from '@billing/shared';
import type { Tx } from './db.service';
import type { LedgerService, PostInput } from './ledger.service';

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

/**
 * Writes an edited payment's entry in the books again — unless an entry of it is ticked in
 * Reconciliation: then an edit that leaves the entry as it was (same date, accounts and amounts)
 * keeps it, so the tick stays, and an edit that changes it is refused. Used where a payment is
 * written again with its invoice or bill, so editing the items still works.
 */
export async function repostPayment(tx: Tx, ledger: LedgerService, ctx: { businessId: string; userId: string }, input: PostInput) {
  const bank = await reconciledIn(tx, 'payment', input.sourceId);
  if (!bank) return ledger.repost(tx, ctx, input);
  if (!(await samePosting(tx, input))) throw new BadRequestException({ message: reconciledMessage(bank) });
  return null;
}

/** A payment's ticked entry is cancelled too (invoice or bill edited to take less): refused while it is ticked. */
export async function refuseIfReconciled(tx: Tx, paymentId: string) {
  const bank = await reconciledIn(tx, 'payment', paymentId);
  if (bank) throw new BadRequestException({ message: reconciledMessage(bank) });
}

/** One line as the books keep it: account, party and the net amount on one side (as LedgerService.post writes it). */
const lineKey = (key: string, partyId: string | null | undefined, dr: Money, cr: Money) => {
  const net = dr.minus(cr);
  return net.isZero() ? '' : `${key}|${partyId ?? ''}|${net.isNegative() ? 'cr' : 'dr'}|${net.abs().toFixed(2)}`;
};

/** Whether the live entry of the source already is exactly this one (date and lines; memos don't count). */
async function samePosting(tx: Tx, input: PostInput) {
  const e = await tx.journalEntry.findFirst({
    where: { sourceType: input.sourceType, sourceId: input.sourceId, cancelledAt: null },
    include: { lines: { include: { account: { select: { key: true } } } } },
  });
  if (!e || e.date.toISOString().slice(0, 10) !== input.date) return false;
  const was = e.lines.map((l) => lineKey(l.account.key, l.partyId, money(l.debit.toString()), money(l.credit.toString()))).filter(Boolean).sort();
  const now = input.lines.map((l) => lineKey(l.account, l.partyId, money(l.debit ?? 0), money(l.credit ?? 0))).filter(Boolean).sort();
  return JSON.stringify(was) === JSON.stringify(now);
}
