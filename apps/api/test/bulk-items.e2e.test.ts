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
interface Item { id: string; name: string; code: string; category: string; description: string; gstRate: string; sale: string; purchase: string; mrp: string; stock: string | null }
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
  it('saves category, item code, description and tax slab changes of many items in one go', async () => {
    const s = await shop();
    const r = await bulk(s.o, [
      { id: s.fan.id, category: 'Ceiling fans', description: '1200 mm sweep, 3 blades' },
      { id: s.bulb.id, gstRate: '18', code: 'LED-9W' },
      { id: s.wire.id, category: '', gstRate: 5 },
    ]).expect(200);
    expect(r.body).toEqual({ updated: 3 });
    expect(await get(s.o, s.fan.id)).toMatchObject({ category: 'Ceiling fans', description: '1200 mm sweep, 3 blades', code: 'CF12', gstRate: '18.00', sale: '1890.00', purchase: '1560.00' });
    expect(await get(s.o, s.bulb.id)).toMatchObject({ code: 'LED-9W', gstRate: '18.00', description: '' });
    expect(await get(s.o, s.wire.id)).toMatchObject({ category: '', gstRate: '5.00' });
    // the new category is in the pickers, as when one item is edited
    const cats = (await http().get('/api/catalogue').set(auth(s.o)).expect(200)).body.categories as { name: string }[];
    expect(cats.map((c) => c.name)).toContain('Ceiling fans');
    // no price changed, so no price history
    const hist = (await http().get(`/api/prices/history?itemId=${s.fan.id}`).set(auth(s.o)).expect(200)).body as unknown[];
    expect(hist).toEqual([]);
  });

  it('writes one audit entry per item with the changed fields (old and new), who and when', async () => {
    const s = await shop();
    await bulk(s.o, [{ id: s.fan.id, description: 'Remote included', category: 'Ceiling fans' }, { id: s.bulb.id, code: 'LED-9W', gstRate: '5' }]).expect(200);
    const edits = await itemEdits(s.o);
    expect(edits).toHaveLength(2);
    const me = (await http().get('/api/me').set(auth(s.o)).expect(200)).body as { user?: { id: string }; id?: string };
    const userId = me.user?.id ?? me.id;
    for (const e of edits) {
      expect(e.userId).toBe(userId);
      expect(Number.isNaN(Date.parse(e.createdAt))).toBe(false);
    }
    // written in one go: no fixed order, so sorted by item name
    const byName = edits.map((e) => ({ name: (e.after as { name: string }).name, id: e.entityId, changes: (e.after as { changes: unknown }).changes })).sort((a, b) => a.name.localeCompare(b.name));
    expect(byName).toEqual([
      { name: 'Ceiling fan 1200mm', id: s.fan.id, changes: [{ field: 'category', old: 'Fans', new: 'Ceiling fans' }, { field: 'description', old: '', new: 'Remote included' }] },
      { name: 'LED bulb 9W', id: s.bulb.id, changes: [{ field: 'code', old: 'LB9', new: 'LED-9W' }, { field: 'gstRate', old: '12.00', new: '5.00' }] },
    ]);
  });

  it('one row that can’t be saved: nothing is saved, and the answer names the item and the reason', async () => {
    const s = await shop();
    // the second row takes the fan's code: refused, so the bulb's new tax slab is not kept either
    const r = await bulk(s.o, [{ id: s.bulb.id, gstRate: 28 }, { id: s.wire.id, code: 'cf12', description: 'Red' }]).expect(409);
    expect(r.body).toMatchObject({ message: 'Wire 1.5 sq mm: This item code is already used. Nothing was saved.', itemId: s.wire.id, field: 'code' });
    expect(await get(s.o, s.bulb.id)).toMatchObject({ gstRate: '12.00' });
    expect(await get(s.o, s.wire.id)).toMatchObject({ code: 'WR15', description: '' });
    expect(await itemEdits(s.o)).toEqual([]);
  });

  it('item codes stay unique in the shop, also between two rows of the same update', async () => {
    const s = await shop();
    const r = await bulk(s.o, [{ id: s.bulb.id, code: 'NEW-1' }, { id: s.wire.id, code: 'new-1' }]).expect(409);
    expect(r.body).toMatchObject({ message: 'Wire 1.5 sq mm: This item code is already used. Nothing was saved.', field: 'code' });
    expect((await get(s.o, s.bulb.id)).code).toBe('LB9');
    // a code freed by an earlier row of the same update can be taken by a later one
    await bulk(s.o, [{ id: s.fan.id, code: 'CF-OLD' }, { id: s.bulb.id, code: 'CF12' }]).expect(200);
    expect([(await get(s.o, s.fan.id)).code, (await get(s.o, s.bulb.id)).code]).toEqual(['CF-OLD', 'CF12']);
  });

  it('refuses prices and stock (Price manager and stock screens change those) and saves nothing', async () => {
    const s = await shop();
    const no = 'Only category, item code, description and tax slab can be changed here. Prices are changed in Price manager.';
    expect((await bulk(s.o, [{ id: s.fan.id, sale: '1999' }]).expect(400)).body.message).toBe(no);
    expect((await bulk(s.o, [{ id: s.fan.id, code: 'X1', purchase: '1' }]).expect(400)).body.message).toBe(no);
    expect((await bulk(s.o, [{ id: s.fan.id, openingQty: '99' }]).expect(400)).body.message).toBe(no);
    const fan = await get(s.o, s.fan.id);
    expect([fan.sale, fan.purchase, fan.code, fan.stock]).toEqual(['1890.00', '1560.00', 'CF12', '10.000']);
    expect(await itemEdits(s.o)).toEqual([]);
  });

  it('checks every value like the single item edit: a real tax slab, rows with changes', async () => {
    const s = await shop();
    expect((await bulk(s.o, [{ id: s.fan.id, gstRate: '120' }]).expect(400)).status).toBe(400);
    expect((await bulk(s.o, []).expect(400)).body.message).toBe('Nothing has changed.');
    expect((await bulk(s.o, [{ id: s.fan.id }]).expect(400)).body.message).toBe('Each row needs at least one change.');
    expect((await get(s.o, s.fan.id)).gstRate).toBe('18.00');
  });

  it('a tax slab change leaves stock, its value by rate and the prices as they were', async () => {
    const s = await shop();
    const before = await get(s.o, s.fan.id);
    await bulk(s.o, [{ id: s.fan.id, gstRate: 28 }]).expect(200);
    const after = await get(s.o, s.fan.id);
    expect([after.stock, after.sale, after.purchase, after.gstRate]).toEqual(['10.000', '1890.00', '1560.00', '28.00']);
    expect(after.movements).toEqual(before.movements);
    expect(after.rateTable).toEqual(before.rateTable);
  });

  it('another shop’s items are refused and nothing is saved in either shop', async () => {
    const a = await shop();
    const b = await shop();
    const r = await bulk(a.o, [{ id: a.fan.id, code: 'MINE' }, { id: b.bulb.id, code: 'THEIRS' }]).expect(404);
    expect(r.body.message).toBe('One item was not found. Nothing was saved. Reload the page and try again.');
    expect((await get(a.o, a.fan.id)).code).toBe('CF12');
    expect((await get(b.o, b.bulb.id)).code).toBe('LB9');
    expect(await itemEdits(b.o)).toEqual([]);
  });

  it('needs a role that may change items', async () => {
    const s = await shop();
    const staff = await member(app, s.o, 'billing_staff');
    await bulk(staff, [{ id: s.fan.id, code: 'X1' }]).expect(403);
    expect((await get(s.o, s.fan.id)).code).toBe('CF12');
  });

  it('with the passcode on: none or wrong is refused, the right one saves, and its use is noted', async () => {
    const s = await shop();
    await turnOn(s.o);
    const rows = [{ id: s.fan.id, description: 'Remote included' }, { id: s.bulb.id, gstRate: 5 }];
    expect((await bulk(s.o, rows).expect(403)).body).toMatchObject({ message: 'Enter the transaction passcode.', code: 'passcode' });
    expect((await bulk(s.o, rows, '0000').expect(403)).body).toMatchObject({ message: 'Wrong passcode. 4 tries left.', code: 'passcode' });
    expect((await get(s.o, s.fan.id)).description).toBe('');
    expect((await bulk(s.o, rows, PASS).expect(200)).body).toEqual({ updated: 2 });
    expect((await get(s.o, s.fan.id)).description).toBe('Remote included');
    expect((await get(s.o, s.bulb.id)).gstRate).toBe('5.00');
    const a = await audit(s.o);
    expect(a.find((e) => e.action === 'passcode_used')).toMatchObject({ entityId: null, after: { for: 'edit', document: 'item' } });
    expectNoPasscode(a, PASS);
  });

  it('5 wrong tries lock it for 60 seconds, even for the right passcode', async () => {
    const s = await shop();
    await turnOn(s.o);
    const rows = [{ id: s.fan.id, code: 'X1' }];
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) msgs.push((await bulk(s.o, rows, '1111').expect(403)).body.message);
    expect(msgs.at(-1)).toBe('Too many wrong tries. Try again in 60 seconds.');
    expect((await bulk(s.o, rows, PASS).expect(403)).body.message).toMatch(/^Too many wrong tries\. Try again in \d+ seconds\.$/);
    expect((await get(s.o, s.fan.id)).code).toBe('CF12');
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
