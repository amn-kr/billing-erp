import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractSnapshot, ImportError, parseBackup } from '../src/extract.ts';

const fx = (n: string) => fs.readFileSync(path.join(__dirname, '../fixtures', n), 'utf8');
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe('parseBackup', () => {
  it('refuses files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow(ImportError);
    expect(() => parseBackup('{"hello":1}')).toThrow(/isn’t a backup/);
  });
});

describe('fresh shop entered through the prototype', () => {
  it('reads business, parties with opening balances, items with opening stock', async () => {
    const s = await extractSnapshot(parseBackup(fx('fresh-shop.backup.json')), { browser });
    expect(s.backup).toMatchObject({ fresh: true, keptSampleItems: false });
    expect(s.business).toMatchObject({ name: 'Gupta Electricals & Hardware', short: 'Gupta Electricals', owner: 'Ravi Gupta', gstin: '09AAGFG2231M1ZQ', state: '09', gstEnabled: true, invoiceNext: 101 });
    expect(s.parties.map((p) => p.name).sort()).toEqual(['Kanpur Cables Pvt Ltd', 'Mehta Electricals', 'Raju Electrician', 'Walk-in Ramesh']);
    const mehta = s.parties.find((p) => p.name === 'Mehta Electricals')!;
    expect(mehta).toMatchObject({ role: 'c', group: 'Wholesale customers', gstin: '09AAJPM7745Q1Z2', email: 'mehta@example.com', creditDays: 30, sample: false });
    expect(mehta.opening).toEqual({ amount: 25000, date: '2026-04-01', kind: 'receive' });
    expect(s.parties.find((p) => p.name === 'Kanpur Cables Pvt Ltd')).toMatchObject({ role: 's', opening: { amount: 48000, kind: 'pay' } });
    expect(s.items).toHaveLength(4);
    const wire = s.items.find((i) => i.code === 'CW15')!;
    expect(wire).toMatchObject({ unit: 'COIL', category: 'Wires & cables', gst: 18, sale: 1890, mrp: 2350, purchase: 1560, minStock: 10, location: 'Rack A1', stock: 25 });
    expect(wire.opening).toEqual([{ qty: 25, price: 1540, date: '2026-04-01' }]);
    expect(s.items.find((i) => i.name === 'Fan installation')).toMatchObject({ service: true, stock: null });
    expect(s.godowns).toEqual([expect.objectContaining({ name: 'Main shop', isDefault: true })]);
    expect(s.taxes.find((t) => t.id === 'g18')).toMatchObject({ rate: 18, type: 'GST' });
    // the prototype starts with Contractor rate and Bulk project switched off
    expect(s.priceLists.map((p) => `${p.name} ${p.active ? 'on' : 'off'}`)).toEqual(['Retail price on', 'Wholesale on', 'Contractor rate off', 'Bulk project (cost plus) off']);
  });
});

describe('fresh shop that kept the sample catalogue', () => {
  it('includes the catalogue the prototype keeps in its code, with no stock', async () => {
    const s = await extractSnapshot(parseBackup(fx('fresh-kept-items.backup.json')), { browser });
    expect(s.backup.keptSampleItems).toBe(true);
    expect(s.items.length).toBeGreaterThan(200);
    expect(s.items.every((i) => i.opening.length === 0)).toBe(true);
    expect(s.parties.map((p) => p.name)).toEqual(['Sonu Wiring Works']);
  });
});

describe('the sample shop', () => {
  it('includes the built-in sample parties and items, marked as samples', async () => {
    const s = await extractSnapshot(parseBackup(fx('sample-shop.backup.json')), { browser });
    expect(s.backup.fresh).toBe(false);
    expect(s.parties.some((p) => p.sample)).toBe(true);
    expect(s.items.length).toBe(288);
    expect(s.priceLists.find((p) => p.id === 'pl2')).toMatchObject({ name: 'Wholesale', rule: 'disc', value: 8, overrides: { i1: 1720 } });
  });
});
