import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

/**
 * Items › Bulk active / inactive: the ticked items are made inactive (or active again) in one
 * transaction, or none; items already in that state are skipped. No passcode, no delete. Results
 * without a fixed order (audit entries written in one go) are compared sorted.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

type S = { token: string };
interface Item { id: string; name: string; archived: boolean; stock: string | null }
interface Audit { action: string; entity: string; entityId: string | null; userId: string | null; createdAt: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }

async function shop() {
  const o = await owner(app);
  const add = async (body: object) => (await http().post('/api/items').set(auth(o)).send(body).expect(201)).body as Item;
  const fan = await add({ name: 'Ceiling fan 1200mm', code: 'CF12', sale: '1890', gstRate: 18, openingQty: '10', openingRate: '1540', openingDate: '2026-04-01' });
  const bulb = await add({ name: 'LED bulb 9W', code: 'LB9', sale: '95', purchase: '62', gstRate: 12 });
  const sw = { group: '6A-10A 1WAY SWITCH', category: 'Switches', gstRate: 18 };
  const coral = await add({ ...sw, name: '6A-10A 1WAY SWITCH · HAVELLS CORAL', brand: 'HAVELLS', series: 'CORAL', sale: '42' });
  const pearlz = await add({ ...sw, name: '6A-10A 1WAY SWITCH · HAVELLS PEARLZ', brand: 'HAVELLS', series: 'PEARLZ', sale: '48' });
  return { o, fan, bulb, coral, pearlz };
}
const setActive = (o: S, ids: string[], active: boolean) => http().post('/api/items/bulk-active').set(auth(o)).send({ ids, active });
const list = async (o: S, archived: string) => (await http().get(`/api/items?archived=${archived}`).set(auth(o)).expect(200)).body as Item[];
const names = (rows: Item[]) => rows.map((i) => i.name).sort();
const audit = async (o: S) => (await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as Audit[];
const archiveEntries = async (o: S) => (await audit(o)).filter((a) => a.entity === 'item' && a.after && 'archived' in a.after && !('name' in a.after));

describe('Bulk active / inactive', () => {
  it('makes many items inactive in one go, variants one by one, and active again', async () => {
    const s = await shop();
    expect((await setActive(s.o, [s.fan.id, s.coral.id], false).expect(200)).body).toEqual({ changed: 2, skipped: 0 });
    expect(names(await list(s.o, 'true'))).toEqual(['6A-10A 1WAY SWITCH · HAVELLS CORAL', 'Ceiling fan 1200mm']);
    // the other variant of the range stays active
    expect(names(await list(s.o, 'false'))).toEqual(['6A-10A 1WAY SWITCH · HAVELLS PEARLZ', 'LED bulb 9W']);
    // "all" lists both, each with its state; the fan keeps its stock
    const all = await list(s.o, 'all');
    expect(all).toHaveLength(4);
    expect(all.find((i) => i.id === s.fan.id)).toMatchObject({ archived: true, stock: '10.000' });
    expect((await setActive(s.o, [s.fan.id, s.coral.id], true).expect(200)).body).toEqual({ changed: 2, skipped: 0 });
    expect(await list(s.o, 'true')).toEqual([]);
  });

  it('skips items already in that state: no change and no audit entry for them', async () => {
    const s = await shop();
    await setActive(s.o, [s.bulb.id], false).expect(200);
    expect((await setActive(s.o, [s.bulb.id, s.fan.id], false).expect(200)).body).toEqual({ changed: 1, skipped: 1 });
    expect((await archiveEntries(s.o)).filter((e) => e.entityId === s.bulb.id)).toHaveLength(1);
  });

  it('writes one audit entry per changed item: who, when and which item', async () => {
    const s = await shop();
    await setActive(s.o, [s.fan.id, s.bulb.id], false).expect(200);
    await setActive(s.o, [s.fan.id], true).expect(200);
    const me = (await http().get('/api/me').set(auth(s.o)).expect(200)).body as { user?: { id: string }; id?: string };
    const userId = me.user?.id ?? me.id;
    const rows = await archiveEntries(s.o);
    for (const e of rows) {
      expect(e.userId).toBe(userId);
      expect(Number.isNaN(Date.parse(e.createdAt))).toBe(false);
    }
    // the same entries as the single Make inactive / Make active
    const got = rows.map((e) => `${e.entityId === s.fan.id ? 'fan' : 'bulb'} ${e.action} ${JSON.stringify(e.after)}`).sort();
    expect(got).toEqual(['bulb cancel {"archived":true}', 'fan cancel {"archived":true}', 'fan update {"archived":false}']);
  });

  it('Make active with a name clash: nothing is changed and the answer names the item', async () => {
    const s = await shop();
    await setActive(s.o, [s.bulb.id], false).expect(200);
    // a new active item with the inactive one's name
    await http().post('/api/items').set(auth(s.o)).send({ name: 'LED bulb 9W', code: 'LB9-NEW', sale: '99', gstRate: 12 }).expect(201);
    await setActive(s.o, [s.fan.id], false).expect(200);
    const before = (await archiveEntries(s.o)).length;
    const r = await setActive(s.o, [s.fan.id, s.bulb.id], true).expect(409);
    expect(r.body).toMatchObject({ message: 'LED bulb 9W: An item with this name or code already exists. Rename one of them first. Nothing was changed.', itemId: s.bulb.id });
    // the fan was in the same request: still inactive
    expect(names(await list(s.o, 'true'))).toEqual(['Ceiling fan 1200mm', 'LED bulb 9W']);
    expect(await archiveEntries(s.o)).toHaveLength(before);
  });

  it('another shop’s item is refused and nothing is changed in either shop', async () => {
    const a = await shop();
    const b = await shop();
    const r = await setActive(a.o, [a.fan.id, b.bulb.id], false).expect(404);
    expect(r.body.message).toBe('One item was not found. Nothing was changed. Reload the page and try again.');
    expect(await list(a.o, 'true')).toEqual([]);
    expect(await list(b.o, 'true')).toEqual([]);
  });

  it('a deleted item counts as not found', async () => {
    const s = await shop();
    await http().post(`/api/items/${s.bulb.id}/delete`).set(auth(s.o)).send({}).expect(200);
    expect((await setActive(s.o, [s.bulb.id], true).expect(404)).body.message).toBe('One item was not found. Nothing was changed. Reload the page and try again.');
  });

  it('checks the request: at least one, at most 500, no item twice', async () => {
    const s = await shop();
    expect((await setActive(s.o, [], false).expect(400)).body.message).toMatch('Select at least one item.');
    expect((await setActive(s.o, Array.from({ length: 501 }, () => s.fan.id), false).expect(400)).body.message).toMatch('Up to 500 items can be changed at once.');
    expect((await setActive(s.o, [s.fan.id, s.fan.id], false).expect(400)).body.message).toMatch('An item is listed twice.');
    await http().post('/api/items/bulk-active').set(auth(s.o)).send({ ids: [s.fan.id] }).expect(400);
    expect(await list(s.o, 'true')).toEqual([]);
  });

  it('needs a role that may change items', async () => {
    const s = await shop();
    const staff = await member(app, s.o, 'billing_staff');
    await setActive(staff, [s.fan.id], false).expect(403);
    expect(await list(s.o, 'true')).toEqual([]);
  });

  it('asks for no passcode, even when it is on', async () => {
    const s = await shop();
    await http().post('/api/settings/passcode/on').set(auth(s.o)).send({ passcode: '4826' }).expect(200);
    expect((await setActive(s.o, [s.fan.id], false).expect(200)).body).toEqual({ changed: 1, skipped: 0 });
  });
});
