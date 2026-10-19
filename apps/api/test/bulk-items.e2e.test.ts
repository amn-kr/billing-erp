import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, expectNoPasscode, member, owner, startApp } from './helpers';

/**
 * Items › Bulk update items: only the changed rows are sent; each is checked with the single item
 * edit's rules and all are saved in one transaction, or none. Made-up passcodes only. Results that
 * have no fixed order (audit entries written in one go) are compared sorted by item name.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const PASS = '4826';
const H = 'x-txn-passcode';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = { token: string };
interface Item { id: string; name: string; code: string; category: string; gstRate: string; sale: string; purchase: string; mrp: string; stock: string | null }
interface Audit { action: string; entity: string; entityId: string | null; userId: string | null; createdAt: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }

async function shop() {
  const o = await owner(app);
  const add = async (body: object) => (await http().post('/api/items').set(auth(o)).send(body).expect(201)).body as Item;
  const fan = await add({ name: 'Ceiling fan 1200mm', code: 'CF12', category: 'Fans', sale: '1890', purchase: '1560', mrp: '2100', gstRate: 18, openingQty: '10', openingRate: '1540', openingDate: '2026-04-01' });
  const bulb = await add({ name: 'LED bulb 9W', code: 'LB9', sale: '95', purchase: '62', gstRate: 12 });
  const wire = await add({ name: 'Wire 1.5 sq mm', code: 'WR15', sale: '1450', purchase: '1200', gstRate: 0 });
  return { o, fan, bulb, wire };
}
const bulk = (o: S, rows: object[], pass?: string) => { const r = http().post('/api/items/bulk-update').set(auth(o)); return (pass ? r.set(H, pass) : r).send({ rows }); };
const get = async (o: S, id: string) => (await http().get(`/api/items/${id}`).set(auth(o)).expect(200)).body as Item & { movements: unknown[]; rateTable: unknown };
const audit = async (o: S) => (await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as Audit[];
const itemEdits = async (o: S) => (await audit(o)).filter((a) => a.entity === 'item' && a.action === 'update');
const turnOn = (o: S) => http().post('/api/settings/passcode/on').set(auth(o)).send({ passcode: PASS }).expect(200);

describe('Bulk update items', () => {
  it('saves price, category, tax slab and item code changes of many items in one go', async () => {
    const s = await shop();
    const r = await bulk(s.o, [
      { id: s.fan.id, sale: '1,950', purchase: '1,600.50', category: 'Ceiling fans' },
      { id: s.bulb.id, gstRate: '18', code: 'LED-9W' },
      { id: s.wire.id, category: '' },
    ]).expect(200);
    expect(r.body).toEqual({ updated: 3 });
    expect(await get(s.o, s.fan.id)).toMatchObject({ sale: '1950.00', purchase: '1600.50', category: 'Ceiling fans', code: 'CF12', gstRate: '18.00', mrp: '2100.00' });
    expect(await get(s.o, s.bulb.id)).toMatchObject({ code: 'LED-9W', gstRate: '18.00', sale: '95.00', purchase: '62.00' });
    expect(await get(s.o, s.wire.id)).toMatchObject({ category: '', sale: '1450.00' });
    // the new category is in the pickers, as when one item is edited
    const cats = (await http().get('/api/catalogue').set(auth(s.o)).expect(200)).body.categories as { name: string }[];
    expect(cats.map((c) => c.name)).toContain('Ceiling fans');
    // price history: one line per changed price, marked as a bulk update
    const hist = (await http().get(`/api/prices/history?itemId=${s.fan.id}`).set(auth(s.o)).expect(200)).body as { field: string; oldValue: string; newValue: string; how: string }[];
    expect(hist.map((h) => ({ field: h.field, oldValue: h.oldValue, newValue: h.newValue, how: h.how })).sort((a, b) => a.field.localeCompare(b.field))).toEqual([
      { field: 'purchase', oldValue: '1560.00', newValue: '1600.50', how: 'Bulk update' },
      { field: 'sale', oldValue: '1890.00', newValue: '1950.00', how: 'Bulk update' },
    ]);
  });

  it('writes one audit entry per item with the changed fields (old and new), who and when', async () => {
    const s = await shop();
    await bulk(s.o, [{ id: s.fan.id, sale: '1950', category: 'Ceiling fans' }, { id: s.bulb.id, code: 'LED-9W', gstRate: '5' }]).expect(200);
    const edits = await itemEdits(s.o);
    expect(edits).toHaveLength(2);
    const me = (await http().get('/api/me').set(auth(s.o)).expect(200)).body as { user?: { id: string }; id?: string };
    const userId = me.user?.id ?? me.id;
    for (const e of edits) {
      expect(e.userId).toBe(userId);
      expect(Number.isNaN(Date.parse(e.createdAt))).toBe(false);
    }
    const byName = edits.map((e) => ({ name: (e.after as { name: string }).name, id: e.entityId, changes: (e.after as { changes: unknown }).changes })).sort((a, b) => a.name.localeCompare(b.name));
    expect(byName).toEqual([
      { name: 'Ceiling fan 1200mm', id: s.fan.id, changes: [{ field: 'category', old: 'Fans', new: 'Ceiling fans' }, { field: 'sale', old: '1890.00', new: '1950.00' }] },
      { name: 'LED bulb 9W', id: s.bulb.id, changes: [{ field: 'code', old: 'LB9', new: 'LED-9W' }, { field: 'gstRate', old: '12.00', new: '5.00' }] },
    ]);
  });

  it('one row that can’t be saved: nothing is saved, and the answer names the item and the reason', async () => {
    const s = await shop();
    // the second row takes the fan's code: refused, so the bulb's new price is not kept either
    const r = await bulk(s.o, [{ id: s.bulb.id, sale: '99' }, { id: s.wire.id, code: 'cf12', purchase: '1250' }]).expect(409);
    expect(r.body).toMatchObject({ message: 'Wire 1.5 sq mm: This item code is already used. Nothing was saved.', itemId: s.wire.id, field: 'code' });
    expect(await get(s.o, s.bulb.id)).toMatchObject({ sale: '95.00' });
    expect(await get(s.o, s.wire.id)).toMatchObject({ code: 'WR15', purchase: '1200.00' });
    expect(await itemEdits(s.o)).toEqual([]);
    const hist = (await http().get(`/api/prices/history?itemId=${s.bulb.id}`).set(auth(s.o)).expect(200)).body as unknown[];
    expect(hist).toEqual([]);
  });

  it('item codes stay unique in the shop, also between two rows of the same update', async () => {
    const s = await shop();
    const r = await bulk(s.o, [{ id: s.bulb.id, code: 'NEW-1' }, { id: s.wire.id, code: 'new-1' }]).expect(409);
    expect(r.body).toMatchObject({ message: 'Wire 1.5 sq mm: This item code is already used. Nothing was saved.', field: 'code' });
    expect((await get(s.o, s.bulb.id)).code).toBe('LB9');
    // the shop's own code moved to another item in the same update is fine once it is free
    await bulk(s.o, [{ id: s.fan.id, code: 'CF-OLD' }, { id: s.bulb.id, code: 'CF12' }]).expect(200);
    expect([(await get(s.o, s.fan.id)).code, (await get(s.o, s.bulb.id)).code]).toEqual(['CF-OLD', 'CF12']);
  });

  it('checks every value like the single item edit: no negative price, a real tax slab, rows with changes', async () => {
    const s = await shop();
    expect((await bulk(s.o, [{ id: s.fan.id, sale: '-5' }]).expect(400)).body.message).toBe('Enter a number.');
    expect((await bulk(s.o, [{ id: s.fan.id, gstRate: '120' }]).expect(400)).status).toBe(400);
    expect((await bulk(s.o, []).expect(400)).body.message).toBe('Nothing has changed.');
    expect((await bulk(s.o, [{ id: s.fan.id }]).expect(400)).body.message).toBe('Each row needs at least one change.');
    expect((await get(s.o, s.fan.id)).sale).toBe('1890.00');
  });

  it('never touches stock: opening stock fields are not taken, and the stock and its value by rate stay the same', async () => {
    const s = await shop();
    const before = await get(s.o, s.fan.id);
    await bulk(s.o, [{ id: s.fan.id, purchase: '1700', openingQty: '99', openingRate: '1', openingDate: '2026-05-01', stock: '500' }]).expect(200);
    const after = await get(s.o, s.fan.id);
    expect(after.stock).toBe('10.000');
    expect(after.movements).toEqual(before.movements);
    // stock bought at 1,540 stays valued at 1,540 by the rate table
    expect(after.rateTable).toEqual(before.rateTable);
    // the Items page's stock value (stock × purchase price) follows the new purchase price
    const list = (await http().get('/api/items').set(auth(s.o)).expect(200)).body as Item[];
    const fan = list.find((i) => i.id === s.fan.id)!;
    expect([fan.stock, fan.purchase]).toEqual(['10.000', '1700.00']);
  });

  it('another shop’s items are refused and nothing is saved in either shop', async () => {
    const a = await shop();
    const b = await shop();
    const r = await bulk(a.o, [{ id: a.fan.id, sale: '1999' }, { id: b.bulb.id, sale: '1' }]).expect(404);
    expect(r.body.message).toBe('One item was not found. Nothing was saved. Reload the page and try again.');
    expect((await get(a.o, a.fan.id)).sale).toBe('1890.00');
    expect((await get(b.o, b.bulb.id)).sale).toBe('95.00');
    expect(await itemEdits(b.o)).toEqual([]);
  });

  it('needs a role that may change items', async () => {
    const s = await shop();
    const staff = await member(app, s.o, 'billing_staff');
    await bulk(staff, [{ id: s.fan.id, sale: '1' }]).expect(403);
    expect((await get(s.o, s.fan.id)).sale).toBe('1890.00');
  });

  it('with the passcode on: none or wrong is refused, the right one saves, and its use is noted', async () => {
    const s = await shop();
    await turnOn(s.o);
    const rows = [{ id: s.fan.id, sale: '1999' }, { id: s.bulb.id, purchase: '60' }];
    expect((await bulk(s.o, rows).expect(403)).body).toMatchObject({ message: 'Enter the transaction passcode.', code: 'passcode' });
    expect((await bulk(s.o, rows, '0000').expect(403)).body).toMatchObject({ message: 'Wrong passcode. 4 tries left.', code: 'passcode' });
    expect((await get(s.o, s.fan.id)).sale).toBe('1890.00');
    expect((await bulk(s.o, rows, PASS).expect(200)).body).toEqual({ updated: 2 });
    expect((await get(s.o, s.fan.id)).sale).toBe('1999.00');
    expect((await get(s.o, s.bulb.id)).purchase).toBe('60.00');
    const a = await audit(s.o);
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: null, after: { for: 'edit', document: 'item' } });
    expectNoPasscode(a, PASS);
  });

  it('5 wrong tries lock it for 60 seconds, even for the right passcode', async () => {
    const s = await shop();
    await turnOn(s.o);
    const rows = [{ id: s.fan.id, sale: '1999' }];
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) msgs.push((await bulk(s.o, rows, '1111').expect(403)).body.message);
    expect(msgs.at(-1)).toBe('Too many wrong tries. Try again in 60 seconds.');
    expect((await bulk(s.o, rows, PASS).expect(403)).body.message).toMatch(/^Too many wrong tries\. Try again in \d+ seconds\.$/);
    expect((await get(s.o, s.fan.id)).sale).toBe('1890.00');
  });

  it('editing one item keeps working the same way, now with the changed fields in its audit entry', async () => {
    const s = await shop();
    await http().patch(`/api/items/${s.fan.id}`).set(auth(s.o)).send({ sale: '1900' }).expect(200);
    const [e] = await itemEdits(s.o);
    expect((e!.after as { changes: unknown }).changes).toEqual([{ field: 'sale', old: '1890.00', new: '1900.00' }]);
    const hist = (await http().get(`/api/prices/history?itemId=${s.fan.id}`).set(auth(s.o)).expect(200)).body as { how: string }[];
    expect(hist.map((h) => h.how)).toEqual(['Edited item']);
  });
});
