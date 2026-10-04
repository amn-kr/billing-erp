import type { INestApplication } from '@nestjs/common';
import { LEDGER_ACCOUNTS, DEFAULT_EXPENSE_CATEGORIES } from '@billing/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService, type Tx } from '../src/common/db.service';
import { LedgerService } from '../src/common/ledger.service';
import { owner, startApp } from './helpers';

/** The books: every entry balances, cancelling takes it out of balances, nothing is deleted. */
let app: INestApplication;
let db: DbService;
let ledger: LedgerService;

beforeAll(async () => {
  app = await startApp();
  db = app.get(DbService);
  ledger = app.get(LedgerService);
});
afterAll(async () => {
  await app.close();
});

const shop = async () => {
  const o = await owner(app);
  const me = await db.scoped({ businessId: o.businessId }, (tx) => tx.business.findUniqueOrThrow({ where: { id: o.businessId } }));
  const ctx = { businessId: o.businessId, userId: me.ownerId };
  const run = <T>(fn: (tx: Tx) => Promise<T>) => db.scoped({ businessId: o.businessId, userId: me.ownerId }, fn);
  return { ctx, run };
};
const uuid = () => crypto.randomUUID();

describe('a new shop', () => {
  it('starts with Cash in hand, the expense categories and the ledger accounts', async () => {
    const { run } = await shop();
    const r = await run(async (tx) => ({
      cash: await tx.cashBankAccount.findMany(),
      cats: await tx.expenseCategory.findMany({ orderBy: { createdAt: 'asc' } }),
      accs: await tx.ledgerAccount.findMany(),
      series: await tx.documentSeries.findMany(),
    }));
    expect(r.cash.map((c) => [c.kind, c.name, c.sub, c.isDefault, c.openingBalance.toString()])).toEqual([['cash', 'Cash in hand', 'Shop counter', true, '0']]);
    expect(r.cats.map((c) => c.name)).toEqual([...DEFAULT_EXPENSE_CATEGORIES]);
    expect(r.accs.map((a) => a.key).sort()).toEqual(LEDGER_ACCOUNTS.map((a) => a.key).sort());
    const pre = Object.fromEntries(r.series.map((s) => [s.docType, `${s.prefix}${s.nextNumber}`]));
    expect(pre).toMatchObject({ invoice: 'INV-1', quotation: 'Q-101', challan: 'DC-1', credit_note: 'CN-1', receipt: 'PI-1', purchase_order: 'ORD-1', bill: 'PB-1', debit_note: 'DN-1', payment: 'PO-1', expense: 'EXP-1', bank_entry: 'BT-1', commission_payout: 'CP-1' });
  });
});

describe('journal', () => {
  it('posts a cash sale and a credit sale, and gives party and cash balances', async () => {
    const { ctx, run } = await shop();
    const out = await run(async (tx) => {
      const party = await tx.party.create({ data: { businessId: ctx.businessId, createdBy: ctx.userId, kind: 'customer', name: 'Verma Traders', openingBalance: '1000', openingType: 'receive' } });
      const cash = (await tx.cashBankAccount.findFirstOrThrow()).id;
      // credit sale: 4717.80 + 424.60 + 424.60 + transport 150 = 5717 (the worked example)
      await ledger.post(tx, ctx, {
        date: '2026-10-04', sourceType: 'sales_document', sourceId: uuid(), number: 'INV-0001',
        lines: [
          { account: 'receivable', partyId: party.id, debit: '5717.00' },
          { account: 'sales', credit: '4717.80' },
          { account: 'output_cgst', credit: '424.60' },
          { account: 'output_sgst', credit: '424.60' },
          { account: 'charges_income', credit: '150.00' },
          { account: 'round_off', debit: '0' },
        ],
      });
      // payment received in cash
      const payId = uuid();
      await ledger.post(tx, ctx, { date: '2026-10-04', sourceType: 'payment', sourceId: payId, number: 'PI-0001', lines: [{ account: `cb:${cash}`, debit: '2000' }, { account: 'receivable', partyId: party.id, credit: '2000' }] });
      const before = { party: (await ledger.partyBalances(tx, [party.id])).get(party.id)!.toFixed(2), cash: (await ledger.cashBankBalances(tx)).get(cash)!.toFixed(2) };
      // cancelling the payment takes it out of both balances; its rows stay
      await ledger.cancel(tx, 'payment', payId);
      const after = { party: (await ledger.partyBalances(tx, [party.id])).get(party.id)!.toFixed(2), cash: (await ledger.cashBankBalances(tx)).get(cash)!.toFixed(2) };
      const acc = await ledger.accountBalances(tx);
      const kept = await tx.journalEntry.count({ where: { sourceId: payId } });
      return { before, after, sales: acc.get('sales')!.toFixed(2), kept, lines: await tx.journalLine.count() };
    });
    expect(out.before).toEqual({ party: '4717.00', cash: '2000.00' });
    expect(out.after).toEqual({ party: '6717.00', cash: '0.00' });
    expect(out.sales).toBe('-4717.80');
    expect(out.kept).toBe(1);
    expect(out.lines).toBe(7); // the zero round-off line is left out
  });

  it('refuses an entry that does not balance — in code and in the database', async () => {
    const { ctx, run } = await shop();
    await expect(run((tx) => ledger.post(tx, ctx, { date: '2026-10-04', sourceType: 'expense', sourceId: uuid(), lines: [{ account: 'expenses', debit: '100' }, { account: 'opening', credit: '99.99' }] })))
      .rejects.toThrow(/does not balance/);
    // straight to the table, skipping the service: the commit is refused
    await expect(run(async (tx) => {
      const accs = await tx.ledgerAccount.findMany({ where: { key: { in: ['expenses', 'opening'] } } });
      const e = await tx.journalEntry.create({ data: { businessId: ctx.businessId, createdBy: ctx.userId, date: new Date('2026-10-04'), sourceType: 'expense', sourceId: uuid() } });
      await tx.journalLine.create({ data: { businessId: ctx.businessId, entryId: e.id, accountId: accs[0]!.id, debit: '100' } });
    })).rejects.toThrow(/does not balance/);
  });

  it('repost replaces an edited document’s entry; a party that is owed money shows negative', async () => {
    const { ctx, run } = await shop();
    const r = await run(async (tx) => {
      const sup = await tx.party.create({ data: { businessId: ctx.businessId, createdBy: ctx.userId, kind: 'supplier', name: 'Havells Distributor', openingBalance: '500', openingType: 'pay' } });
      const id = uuid();
      const bill = (amt: string) => ({ date: '2026-10-04', sourceType: 'purchase_document', sourceId: id, number: 'PB-0001', lines: [{ account: 'purchases', debit: amt }, { account: 'payable', partyId: sup.id, credit: amt }] });
      await ledger.post(tx, ctx, bill('1180'));
      await ledger.repost(tx, ctx, bill('2360'));
      return { bal: (await ledger.partyBalances(tx, [sup.id])).get(sup.id)!.toFixed(2), live: await tx.journalEntry.count({ where: { sourceId: id, cancelledAt: null } }), all: await tx.journalEntry.count({ where: { sourceId: id } }) };
    });
    expect(r).toEqual({ bal: '-2860.00', live: 1, all: 2 });
  });

  it('a shop never sees another shop’s journal, and the app cannot change or delete journal lines', async () => {
    const a = await shop();
    const b = await shop();
    await a.run((tx) => ledger.post(tx, a.ctx, { date: '2026-10-04', sourceType: 'expense', sourceId: uuid(), lines: [{ account: 'expenses', debit: '50' }, { account: 'opening', credit: '50' }] }));
    expect(await b.run((tx) => tx.journalLine.count())).toBe(0);
    await expect(a.run((tx) => tx.journalLine.updateMany({ data: { debit: '60' } }))).rejects.toThrow(/permission denied/);
    await expect(a.run((tx) => tx.journalEntry.deleteMany({}))).rejects.toThrow(/permission denied/);
  });
});
