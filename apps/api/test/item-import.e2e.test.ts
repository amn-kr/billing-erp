import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IMPORT_KEYS, type ImportRow } from '@billing/shared';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = { token: string };
/** a row as typed in the template; blank cells as '' */
const row = (line: number, v: Partial<Record<(typeof IMPORT_KEYS)[number], string>>): ImportRow =>
  ({ line, ...Object.fromEntries(IMPORT_KEYS.map((k) => [k, ''])), ...v }) as ImportRow;
const single = (line: number, name: string, brand: string, code: string, v: Partial<ImportRow> = {}) => row(line, { type: 'Single Range', name, brand, code, ...v });
const multi = (line: number, name: string, brand: string, series: string, code: string, v: Partial<ImportRow> = {}) => row(line, { type: 'Multi Range', name, brand, series, code, ...v });
const run = (s: S, rows: ImportRow[], skipErrors = false) => http().post('/api/items/import').set(auth(s)).send({ rows, skipErrors });
type Item = { id: string; name: string; code: string; brand: string; group: string; series: string; unit: string; category: string; gstRate: string; hsn: string; sale: string; purchase: string; minStock: string; stock: string };
const items = async (s: S) => (await http().get('/api/items').set(auth(s)).expect(200)).body as Item[];
const byCode = async (s: S, code: string) => (await items(s)).find((i) => i.code === code)!;

describe('Items › Import products', () => {
  it('gives the shop’s lists to check against', async () => {
    const o = await owner(app);
    await http().post('/api/items').set(auth(o)).send({ name: 'Switch · Havells Coral', group: 'Switch', brand: 'Havells', series: 'Coral', code: 'HC1' }).expect(201);
    const c = (await http().get('/api/items/import/context').set(auth(o)).expect(200)).body;
    expect(c.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.items).toEqual([{ name: 'Switch · Havells Coral', code: 'HC1', group: 'Switch', brand: 'Havells', series: 'Coral' }]);
    expect(c.brands).toEqual([{ name: 'Havells', active: true }]);
    expect(c.groups).toEqual(['Switch']);
    expect(c.units.map((u: { code: string }) => u.code)).toContain('PCS');
    expect(c.godowns).toEqual([{ name: 'Main shop', isDefault: true }]);
    expect(c.gstRates).toEqual(expect.arrayContaining(['0', '5', '18', '28']));
    expect(c.categories.length).toBeGreaterThan(0);
  });

  it('imports Single and Multi Range rows with opening stock, new brands, series, parent items and categories', async () => {
    const o = await owner(app);
    await http().post('/api/godowns').set(auth(o)).send({ name: 'Back godown' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'Switch · HAVELLS Coral', group: 'Switch', brand: 'HAVELLS', series: 'Coral', code: 'HC1' }).expect(201);
    const r = await run(o, [
      single(2, 'Bajaj fan 1200', 'Bajaj', 'BJ-1200', { qty: '6', rate: '1,052.50', date: '01-04-2026', unit: 'pcs', sale: '1250', min: '2', category: 'Fans', gst: '18%', hsn: '8414' }),
      // existing brand typed in small letters: the shop's spelling is kept, no new brand
      multi(3, 'Switch', 'havells', 'Oro', 'HO1', { qty: '200', rate: '18', date: '2026-04-01', godown: 'back GODOWN', category: 'Solar', sale: '26' }),
      // new parent item, brand and series; no date → today; no GST → 18
      multi(4, 'LED batten 20W', 'Wipro', 'Garnet', 'WG20', { qty: '40', rate: '165', unit: 'BOX' }),
      // no opening stock: At price is still the purchase price
      single(5, 'Door bell', 'Anchor', 'DB1', { rate: '120', sale: '150' }),
    ]).expect(200);
    expect(r.body.done).toBe(true);
    expect(r.body.summary).toEqual({
      created: 4, withStock: 3, skipped: [],
      newBrands: ['Bajaj', 'Wipro', 'Anchor'], newSeries: ['HAVELLS Oro', 'Wipro Garnet'], newGroups: ['LED batten 20W'], newCategories: ['Solar'],
    });

    const fan = await byCode(o, 'BJ-1200');
    expect(fan).toMatchObject({ name: 'Bajaj fan 1200', brand: 'Bajaj', group: '', unit: 'PCS', category: 'Fans', gstRate: '18.00', hsn: '8414', sale: '1250.00', purchase: '1052.50', minStock: '2.000', stock: '6.000' });
    const oro = await byCode(o, 'HO1');
    expect(oro).toMatchObject({ name: 'Switch · HAVELLS Oro', brand: 'HAVELLS', group: 'Switch', series: 'Oro', category: 'Solar', purchase: '18.00', stock: '200.000' });
    const led = await byCode(o, 'WG20');
    expect(led).toMatchObject({ name: 'LED batten 20W · Wipro Garnet', unit: 'BOX', gstRate: '18.00', purchase: '165.00' });
    expect(await byCode(o, 'DB1')).toMatchObject({ purchase: '120.00', sale: '150.00', stock: '0.000' });

    // opening stock: in the named godown (blank = Main shop), on the date given (blank = today), in the rate table
    const d = (await http().get(`/api/items/${oro.id}`).set(auth(o)).expect(200)).body;
    expect(d.movements).toMatchObject([{ kind: 'opening', qty: '200.000', rate: '18.00', date: '2026-04-01', godown: 'Back godown', note: 'Opening stock' }]);
    expect(d.rateTable).toMatchObject({ layers: [{ rate: '18.00', qty: '200.000', since: '2026-04-01' }], totalQty: '200.000', value: '3600.00' });
    const l = (await http().get(`/api/items/${led.id}`).set(auth(o)).expect(200)).body;
    const today = (await http().get('/api/items/import/context').set(auth(o)).expect(200)).body.today;
    expect(l.movements).toMatchObject([{ kind: 'opening', qty: '40.000', rate: '165.00', date: today, godown: 'Main shop' }]);

    // Brands & Series has the new series
    const series = (await http().get('/api/brand-series').set(auth(o)).expect(200)).body as { brand: string; name: string; id: string | null }[];
    expect(series.filter((s) => s.id).map((s) => `${s.brand} ${s.name}`).sort()).toEqual(['HAVELLS Oro', 'Wipro Garnet']);

    // audit: every created item, brand, series, parent item and category
    const log = (await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as { action: string; entity: string; after: { from?: string; name?: string } }[];
    const imp = log.filter((a) => a.after?.from === 'import');
    const count = (e: string) => imp.filter((a) => a.entity === e && a.action === 'create').length;
    expect([count('item'), count('brand'), count('brand_series'), count('item_group'), count('category')]).toEqual([4, 3, 2, 1, 1]);
  });

  it('saves nothing while a row has an error, and says which rows', async () => {
    const o = await owner(app);
    const before = (await items(o)).length;
    const r = await run(o, [
      single(2, 'Good item', 'Bajaj', 'G1', { qty: '1', rate: '10' }),
      // Multi Range still needs a brand
      multi(3, 'No brand', '', 'Coral', 'G2'),
      single(4, 'Bad date', 'Bajaj', 'G3', { qty: '1', rate: '5', date: '31-02-2026' }),
    ]).expect(200);
    expect(r.body.done).toBe(false);
    expect(r.body.message).toBe('2 rows have errors. Fix them or tick “Skip error rows”. Nothing was imported.');
    expect(r.body.checks.map((c: { line: number; status: string }) => `${c.line} ${c.status}`)).toEqual(['2 warning', '3 error', '4 error']);
    expect((await items(o)).length).toBe(before);
    const brands = (await http().get('/api/brands').set(auth(o)).expect(200)).body;
    expect(brands).toEqual([]);
  });

  it('Single Range without a brand: saved with no brand; a series needs a brand; the name must still be new; Multi still needs one', async () => {
    const o = await owner(app);
    // made on Add item without a brand
    await http().post('/api/items').set(auth(o)).send({ name: 'Insulation tape', code: '' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'Bajaj fan', brand: 'Bajaj', code: 'BJ1' }).expect(201);
    const rows = [
      single(2, 'PVC wire clip', '', '', { qty: '100', rate: '2', date: '01-04-2026', sale: '3' }),
      single(3, 'Wall plug', '', 'WP1', { series: 'Coral' }),
      single(4, 'INSULATION TAPE', '', ''),
      // a Single Range name must be new in the whole shop, whatever the brand
      single(5, 'bajaj fan', '', ''),
      single(6, 'Insulation tape', 'Anchor', ''),
      multi(7, 'Switch', '', 'Roma', ''),
    ];
    const r = await run(o, rows, true).expect(200);
    expect(r.body.done).toBe(true);
    expect(r.body.summary).toEqual({
      created: 1, withStock: 1, newBrands: [], newSeries: [], newGroups: [], newCategories: [],
      skipped: [
        { line: 3, reasons: ['Series / range name: Series needs a brand. Enter the brand name, or clear the series.'] },
        { line: 4, reasons: ['Product name: An item called “Insulation tape” already exists.', 'Product name: This product name is also in row 6 of the uploaded file.'] },
        { line: 5, reasons: ['Product name: An item called “Bajaj fan” already exists.'] },
        { line: 6, reasons: ['Product name: An item called “Insulation tape” already exists.', 'Product name: This product name is also in row 4 of the uploaded file.'] },
        { line: 7, reasons: ['Brand name: Enter the brand name.'] },
      ],
    });
    const clip = (await items(o)).find((i) => i.name === 'PVC wire clip')!;
    expect(clip).toMatchObject({ brand: '', group: '', series: '', stock: '100.000', purchase: '2.00' });
    // no brand made from the blank cell; the only brand is the one Add item made
    expect(((await http().get('/api/brands').set(auth(o)).expect(200)).body as { name: string }[]).map((b) => b.name)).toEqual(['Bajaj']);
    // audit as for every imported item, with no brand
    const log = (await http().get('/api/audit?limit=50').set(auth(o)).expect(200)).body as { entity: string; entityId: string; after: { from?: string; brand?: string } }[];
    expect(log.filter((a) => a.after?.from === 'import').map((a) => [a.entity, a.entityId, a.after.brand])).toEqual([['item', clip.id, '']]);
  });

  it('“Skip error rows” imports the rest and lists the skipped rows with reasons', async () => {
    const o = await owner(app);
    const r = await run(o, [
      single(2, 'Fan', 'Bajaj', 'F1', { qty: '3', rate: '900' }),
      single(3, 'fan', 'Bajaj', 'F2'),
      single(4, 'Plug', 'Anchor', 'P1', { qty: '-5', rate: '10' }),
      single(5, 'Bulb', 'Philips', 'B1', { unit: 'DOZEN' }),
      single(6, 'Bulb holder', 'Anchor', 'BH1', { sale: '40' }),
    ], true).expect(200);
    expect(r.body.done).toBe(true);
    expect(r.body.summary).toMatchObject({ created: 1, withStock: 0, newBrands: ['Anchor'] });
    expect((await items(o)).map((i) => i.name)).toEqual(['Bulb holder']);
    expect(r.body.summary.skipped).toEqual([
      { line: 2, reasons: ['Product name: This product name is also in row 3 of the uploaded file.'] },
      { line: 3, reasons: ['Product name: This product name is also in row 2 of the uploaded file.'] },
      { line: 4, reasons: ['Opening stock: Opening stock cannot be negative.'] },
      { line: 5, reasons: ['Base unit: Unit “DOZEN” is not in your units. Choose one from the list.'] },
    ]);
  });

  it('a file of only error rows imports nothing even with “Skip error rows”', async () => {
    const o = await owner(app);
    const r = await run(o, [single(2, '', 'Bajaj', 'X1')], true).expect(200);
    expect(r.body).toMatchObject({ done: false, message: 'There are no rows without errors to import. Nothing was imported.' });
  });

  it('checks again on Final import: a code used since the file was checked stops the import', async () => {
    const o = await owner(app);
    const rows = [single(2, 'Fan', 'Bajaj', 'F1', { qty: '3', rate: '900' }), single(3, 'Plug', 'Anchor', 'P1')];
    // the screen saw no problem; then someone adds an item with code P1
    const ctx = (await http().get('/api/items/import/context').set(auth(o)).expect(200)).body;
    expect(ctx.items).toEqual([]);
    await http().post('/api/items').set(auth(o)).send({ name: 'Other plug', code: 'p1' }).expect(201);
    const r = await run(o, rows).expect(200);
    expect(r.body.done).toBe(false);
    expect(r.body.checks[1].cells.code).toEqual([{ level: 'error', message: 'Brand code P1 is already used by “Other plug”.' }]);
    expect((await items(o)).map((i) => i.name)).toEqual(['Other plug']);
  });

  it('refuses duplicates of existing items: Single name, Multi product + brand + series, and brand code', async () => {
    const o = await owner(app);
    await http().post('/api/items').set(auth(o)).send({ name: 'Bajaj fan', brand: 'Bajaj', code: 'BJ1' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'Switch · Havells Coral', group: 'Switch', brand: 'Havells', series: 'Coral', code: 'HC1' }).expect(201);
    const r = await run(o, [
      single(2, 'BAJAJ FAN', 'Bajaj', 'BJ2'),
      multi(3, 'switch', 'HAVELLS', 'coral', 'HC2'),
      single(4, 'New fan', 'Bajaj', 'bj1'),
      // the same product name for many brands and series is allowed for Multi Range
      multi(5, 'Switch', 'Havells', 'Oro', 'HO1'),
      multi(6, 'Switch', 'Anchor', 'Roma', 'AR1'),
    ]).expect(200);
    const st = r.body.checks.map((c: { status: string }) => c.status);
    expect(st).toEqual(['error', 'error', 'error', 'warning', 'warning']);
    expect(r.body.checks[0].cells.name[0].message).toBe('An item called “Bajaj fan” already exists.');
    expect(r.body.checks[1].cells.series[0].message).toBe('Havells Coral is already in Switch (item “Switch · Havells Coral”).');
    expect(r.body.checks[2].cells.code[0].message).toBe('Brand code bj1 is already used by “Bajaj fan”.');
  });

  it('brand code is optional: blank codes import, given codes are kept and still checked, existing codes stay', async () => {
    const o = await owner(app);
    await http().post('/api/items').set(auth(o)).send({ name: 'Switch · Havells Coral', group: 'Switch', brand: 'Havells', series: 'Coral', code: 'HC1' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'Old bulb', brand: 'Philips', code: '' }).expect(201);
    const r = await run(o, [
      // no code, an existing brand and parent item: fine
      multi(2, 'Switch', 'Havells', 'Oro', '', { qty: '5', rate: '40' }),
      // no code, like an existing item without a code: fine
      single(3, 'New bulb', 'Philips', ''),
      multi(4, 'Switch', 'Anchor', 'Roma', ''),
      // a code still works as before
      single(5, 'Fan', 'Bajaj', 'BJ-1'),
    ]).expect(200);
    expect(r.body.done).toBe(true);
    expect(r.body.summary).toMatchObject({ created: 4, skipped: [] });
    const all = await items(o);
    const code = (name: string) => all.find((i) => i.name === name)!.code;
    expect([code('Switch · Havells Oro'), code('New bulb'), code('Switch · Anchor Roma'), code('Fan')]).toEqual(['', '', '', 'BJ-1']);
    // the items that were there keep their codes; a blank cell never clears one
    expect([code('Switch · Havells Coral'), code('Old bulb')]).toEqual(['HC1', '']);
    // a code already used, or twice in the file, is still an error; blank ones are not
    const d = await run(o, [single(2, 'Fan 2', 'Bajaj', 'bj-1'), single(3, 'A', 'Bajaj', 'Z9'), single(4, 'B', 'Bajaj', 'z9'), single(5, 'C', 'Bajaj', ''), single(6, 'D', 'Bajaj', '')]).expect(200);
    expect(d.body.done).toBe(false);
    expect(d.body.checks.map((c: { status: string }) => c.status)).toEqual(['error', 'error', 'error', 'warning', 'warning']);
    expect(d.body.checks[0].cells.code[0].message).toBe('Brand code bj-1 is already used by “Fan”.');
    expect(d.body.checks[1].cells.code[0].message).toBe('This brand code is also in row 4 of the uploaded file.');
  });

  it('another shop’s items do not count as duplicates', async () => {
    const a = await owner(app);
    const b = await owner(app);
    await http().post('/api/items').set(auth(a)).send({ name: 'Bajaj fan', brand: 'Bajaj', code: 'BJ1' }).expect(201);
    const r = await run(b, [single(2, 'Bajaj fan', 'Bajaj', 'BJ1')]).expect(200);
    expect(r.body.done).toBe(true);
    expect((await items(b)).map((i) => i.name)).toEqual(['Bajaj fan']);
    expect((await items(a)).length).toBe(1);
  });

  it('needs permission to manage items; refuses empty and over-size files', async () => {
    const o = await owner(app);
    const staff = await member(app, o, 'billing_staff');
    await http().get('/api/items/import/context').set(auth(staff)).expect(403);
    await run(staff, [single(2, 'Fan', 'Bajaj', 'F1')]).expect(403);
    expect((await run(o, []).expect(400)).body.message).toBe('There are no rows to import.');
    const many = Array.from({ length: 5001 }, (_, i) => single(i + 2, `Item ${i}`, 'Bajaj', `C${i}`));
    expect((await run(o, many).expect(400)).body.message).toBe('A file can have at most 5,000 rows.');
    expect((await items(o)).length).toBe(0);
  });

  it('imports 5,000 rows in one go', async () => {
    const o = await owner(app);
    const rows = Array.from({ length: 5000 }, (_, i) => (i % 2
      ? multi(i + 2, `Product ${i % 50}`, `Brand ${i % 7}`, `S${i}`, `M${i}`, { qty: '10', rate: '12.5', date: '01-04-2026', sale: '15', gst: '18' })
      : single(i + 2, `Item ${i}`, 'Bajaj', `C${i}`, { qty: '1', rate: '100', date: '01-04-2026', sale: '120', gst: '18' })));
    const r = await run(o, rows).expect(200);
    expect(r.body.done).toBe(true);
    expect(r.body.summary).toMatchObject({ created: 5000, withStock: 5000, skipped: [] });
    expect((await items(o)).length).toBe(5000);
  }, 180_000);
});
