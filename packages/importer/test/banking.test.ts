import { describe, expect, it } from 'vitest';
import { planBanking } from '../src/banking.ts';

const demoAccts = [
  { id: 'cash', kind: 'cash', name: 'Cash in hand', open: 45000, od: '01/09/2026' },
  { id: 'hdfc', kind: 'bank', name: 'HDFC Bank', open: 325000, od: '01/09/2026', def: 1 },
  { id: 'sbi', kind: 'bank', name: 'State Bank of India', open: 118000, od: '01/09/2026' },
];
const demoBtx = [
  { no: 'BT-0004', date: '28/09/2026', kind: 'deposit', from: 'cash', to: 'hdfc', amount: 40000 },
  { no: 'BT-0003', date: '25/09/2026', kind: 'out', acct: 'cash', amount: 6500, cat: 'Shop expense' },
  { no: 'BT-0002', date: '20/09/2026', kind: 'out', acct: 'hdfc', amount: 354, cat: 'Bank charges' },
  { no: 'BT-0001', date: '15/09/2026', kind: 'transfer', from: 'hdfc', to: 'sbi', amount: 25000 },
];

describe('banking from an old backup', () => {
  it('leaves out the demo accounts and entries of a shop that did not start fresh', () => {
    const warnings: string[] = [];
    const p = planBanking({ 'erp-accts': demoAccts, 'erp-btx': demoBtx }, { fresh: false, keepDemo: false, warnings }, '2026-10-01');
    expect(p.accounts.map((a) => [a.name, a.openingBalance])).toEqual([['Cash in hand', '0.00']]);
    expect(p.entries).toEqual([]);
    expect(warnings.join(' ')).toMatch(/demo banking data \(2 bank accounts and 4 entries\)/);
  });

  it('keeps a demo account that a real entry uses, with a zero opening balance and a note', () => {
    const warnings: string[] = [];
    const p = planBanking({ 'erp-accts': demoAccts, 'erp-btx': [{ no: 'BT-0005', date: '01/10/2026', kind: 'in', acct: 'hdfc', amount: 1200, cat: 'Other income' }, ...demoBtx] }, { fresh: false, keepDemo: false, warnings }, '2026-10-01');
    expect(p.accounts.map((a) => [a.name, a.openingBalance, a.isDefault])).toEqual([['Cash in hand', '0.00', false], ['HDFC Bank', '0.00', true]]);
    expect(p.entries.map((e) => [e.number, e.amount])).toEqual([['BT-0005', '1200.00']]);
    expect(warnings.join(' ')).toMatch(/HDFC Bank is one of the old app’s demo accounts/);
  });

  it('keeps everything when the demo data is asked for', () => {
    const p = planBanking({ 'erp-accts': demoAccts, 'erp-btx': demoBtx }, { fresh: false, keepDemo: true, warnings: [] }, '2026-10-01');
    expect(p.accounts).toHaveLength(3);
    expect(p.entries.map((e) => e.number)).toEqual(['BT-0001', 'BT-0002', 'BT-0003', 'BT-0004']);
  });
});
