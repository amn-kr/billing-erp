import { BadRequestException, Injectable } from '@nestjs/common';
import { LEDGER_ACCOUNTS, money, type Money, type MoneyInput } from '@billing/shared';
import type { Tx } from './db.service';

export interface PostLine {
  /** a system account key (LEDGER_ACCOUNTS) or "cb:<cash/bank account id>" */
  account: string;
  partyId?: string | null;
  debit?: MoneyInput;
  credit?: MoneyInput;
  memo?: string;
}
export interface PostInput {
  date: string;
  sourceType: string;
  sourceId: string;
  number?: string;
  narration?: string;
  lines: PostLine[];
}

const day = (iso: string) => new Date(iso + 'T00:00:00Z');

/**
 * Double-entry books. Every document writes one balanced journal entry; editing
 * a document cancels its entry and writes a new one; cancelling a document
 * cancels its entry. Nothing is ever deleted, so the history stays complete.
 * (The database also refuses an entry whose debits and credits differ.)
 */
@Injectable()
export class LedgerService {
  /** Creates the system accounts once per shop. */
  async ensureAccounts(tx: Tx, businessId: string, userId: string) {
    await tx.ledgerAccount.createMany({ data: LEDGER_ACCOUNTS.map((a) => ({ businessId, createdBy: userId, ...a })), skipDuplicates: true });
  }

  private async accountIds(tx: Tx, businessId: string, userId: string, keys: string[]) {
    const want = [...new Set(keys)];
    let rows = await tx.ledgerAccount.findMany({ where: { key: { in: want } }, select: { id: true, key: true } });
    if (rows.length < want.length) {
      await this.ensureAccounts(tx, businessId, userId);
      const cb = want.filter((k) => k.startsWith('cb:') && !rows.some((r) => r.key === k));
      for (const k of cb) {
        const acc = await tx.cashBankAccount.findUnique({ where: { id: k.slice(3) } });
        if (!acc) throw new BadRequestException({ message: 'That cash or bank account does not exist.' });
        await tx.ledgerAccount.createMany({ data: [{ businessId, createdBy: userId, key: k, name: acc.name, type: 'asset' }], skipDuplicates: true });
      }
      rows = await tx.ledgerAccount.findMany({ where: { key: { in: want } }, select: { id: true, key: true } });
    }
    const map = new Map(rows.map((r) => [r.key, r.id]));
    for (const k of want) if (!map.has(k)) throw new Error(`unknown ledger account ${k}`);
    return map;
  }

  /** Writes one balanced entry. Zero lines are left out; an entry with no lines is not written. */
  async post(tx: Tx, ctx: { businessId: string; userId: string }, input: PostInput) {
    const lines = input.lines
      .map((l) => ({ ...l, dr: money(l.debit ?? 0), cr: money(l.credit ?? 0) }))
      // a negative amount goes on the other side (e.g. a negative round-off)
      .map((l) => (l.dr.minus(l.cr).isNegative() ? { ...l, dr: money(0), cr: l.cr.minus(l.dr) } : { ...l, dr: l.dr.minus(l.cr), cr: money(0) }))
      .filter((l) => !l.dr.isZero() || !l.cr.isZero());
    const dr = lines.reduce((s: Money, l) => s.plus(l.dr), money(0));
    const cr = lines.reduce((s: Money, l) => s.plus(l.cr), money(0));
    if (!dr.eq(cr)) throw new Error(`journal entry for ${input.sourceType} ${input.number ?? input.sourceId} does not balance: debit ${dr.toFixed(2)}, credit ${cr.toFixed(2)}`);
    if (!lines.length) return null;
    const ids = await this.accountIds(tx, ctx.businessId, ctx.userId, lines.map((l) => l.account));
    const entry = await tx.journalEntry.create({
      data: {
        businessId: ctx.businessId, createdBy: ctx.userId, date: day(input.date), sourceType: input.sourceType, sourceId: input.sourceId,
        number: input.number ?? '', narration: input.narration ?? '',
      },
    });
    await tx.journalLine.createMany({
      data: lines.map((l) => ({
        businessId: ctx.businessId, entryId: entry.id, accountId: ids.get(l.account)!, partyId: l.partyId ?? null,
        debit: l.dr.toFixed(2), credit: l.cr.toFixed(2), memo: l.memo ?? '',
      })),
    });
    return entry;
  }

  /** Cancels the live entries of a document (it no longer counts in any balance). */
  async cancel(tx: Tx, sourceType: string, sourceId: string) {
    await tx.journalEntry.updateMany({ where: { sourceType, sourceId, cancelledAt: null }, data: { cancelledAt: new Date() } });
  }

  /** After an edit: the old entry is cancelled and the new one written. */
  async repost(tx: Tx, ctx: { businessId: string; userId: string }, input: PostInput) {
    await this.cancel(tx, input.sourceType, input.sourceId);
    return this.post(tx, ctx, input);
  }

  /**
   * Party balances: positive = the party owes the shop ("to receive"),
   * negative = the shop owes the party ("to pay"). Opening balance + live entries.
   */
  async partyBalances(tx: Tx, partyIds?: string[]): Promise<Map<string, Money>> {
    const parties = await tx.party.findMany({
      where: partyIds ? { id: { in: partyIds } } : {},
      select: { id: true, openingBalance: true, openingType: true },
    });
    const sums = await tx.$queryRaw<{ party_id: string; bal: string }[]>`
      SELECT l.party_id, sum(l.debit - l.credit)::text AS bal
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.cancelled_at IS NULL AND l.party_id IS NOT NULL
      GROUP BY l.party_id`;
    const moved = new Map(sums.map((s) => [s.party_id, money(s.bal)]));
    return new Map(parties.map((p) => {
      const open = money(p.openingBalance.toString());
      return [p.id, (p.openingType === 'pay' ? open.negated() : open).plus(moved.get(p.id) ?? 0)];
    }));
  }

  /** Cash and bank balances: opening balance + live entries on each account's ledger. */
  async cashBankBalances(tx: Tx): Promise<Map<string, Money>> {
    const accs = await tx.cashBankAccount.findMany({ select: { id: true, openingBalance: true } });
    const sums = await tx.$queryRaw<{ key: string; bal: string }[]>`
      SELECT a.key, sum(l.debit - l.credit)::text AS bal
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
      WHERE e.cancelled_at IS NULL AND a.key LIKE 'cb:%'
      GROUP BY a.key`;
    const moved = new Map(sums.map((s) => [s.key.slice(3), money(s.bal)]));
    return new Map(accs.map((a) => [a.id, money(a.openingBalance.toString()).plus(moved.get(a.id) ?? 0)]));
  }

  /** Balance of each system account (debit − credit), for reports and checks. */
  async accountBalances(tx: Tx): Promise<Map<string, Money>> {
    const sums = await tx.$queryRaw<{ key: string; bal: string }[]>`
      SELECT a.key, coalesce(sum(l.debit - l.credit) FILTER (WHERE e.cancelled_at IS NULL), 0)::text AS bal
      FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id LEFT JOIN journal_entries e ON e.id = l.entry_id
      GROUP BY a.key`;
    return new Map(sums.map((s) => [s.key, money(s.bal)]));
  }
}
