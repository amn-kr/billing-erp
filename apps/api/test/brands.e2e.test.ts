import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type Row = { id: string | null; name: string; brand?: string; brandId?: string; series?: number; items: number; stock: string; value: string; active: boolean; size?: string; notes?: string };
const find = (rows: Row[], name: string, brand?: string) => rows.find((r) => r.name === name && (!brand || r.brand === brand))!;

describe('Items › Brands & Series', () => {
  it('lists brands and series from items, with counts, stock and value', async () => {
    const o = await owner(app);
    // two switch variants (Havells Coral 120 @ 34, Norwood Classic 15 @ 21) and LED 12W (Havells, no series, 60 @ 72)
    await http().post('/api/items').set(auth(o)).send({ name: '6A-10A 1WAY SWITCH · HAVELLS CORAL', group: '6A-10A 1WAY SWITCH', brand: 'HAVELLS', series: 'CORAL', purchase: '34', openingQty: '120' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: '6A-10A 1WAY SWITCH · NORWOOD CLASSIC', group: '6A-10A 1WAY SWITCH', brand: 'NORWOOD', series: 'CLASSIC', purchase: '21', openingQty: '15' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'LED 12W', brand: 'HAVELLS', purchase: '72', openingQty: '60' }).expect(201);
    const brands = (await http().get('/api/brands').set(auth(o)).expect(200)).body as Row[];
    expect(find(brands, 'HAVELLS')).toMatchObject({ series: 1, items: 2, stock: '180.000', value: '8400.00', active: true });
    expect(find(brands, 'NORWOOD')).toMatchObject({ series: 1, items: 1, stock: '15.000', value: '315.00', active: true });
    const series = (await http().get('/api/brand-series').set(auth(o)).expect(200)).body as Row[];
    expect(series.map((s) => `${s.brand} ${s.name}`)).toEqual(['HAVELLS CORAL', 'NORWOOD CLASSIC']);
    // typed only on items: no id until it is changed here
    expect(find(series, 'CORAL')).toMatchObject({ id: null, items: 1, stock: '120.000', value: '4080.00' });
  });

  it('add brand and series; duplicates and blanks are refused in plain words', async () => {
    const o = await owner(app);
    const b = await http().post('/api/brands').set(auth(o)).send({ name: 'Anchor', notes: 'Panasonic group' }).expect(201);
    expect((await http().post('/api/brands').set(auth(o)).send({ name: 'ANCHOR' }).expect(409)).body.message).toBe('A brand called ANCHOR already exists.');
    expect((await http().post('/api/brands').set(auth(o)).send({ name: ' ' }).expect(400)).body.message).toBe('Enter the brand name.');
    await http().post('/api/brand-series').set(auth(o)).send({ brandId: b.body.id, name: 'Roma', size: '6A' }).expect(201);
    expect((await http().post('/api/brand-series').set(auth(o)).send({ brandId: b.body.id, name: 'roma' }).expect(409)).body.message).toBe('Anchor already has a series called roma.');
    expect((await http().post('/api/brand-series').set(auth(o)).send({ name: 'Roma' }).expect(400)).body.message).toBe('Choose a brand.');
    const brands = (await http().get('/api/brands').set(auth(o)).expect(200)).body as Row[];
    expect(find(brands, 'Anchor')).toMatchObject({ notes: 'Panasonic group', series: 1, items: 0, stock: '0.000', value: '0.00' });
    const s = find((await http().get('/api/brand-series').set(auth(o)).expect(200)).body, 'Roma');
    expect(s).toMatchObject({ brand: 'Anchor', size: '6A', items: 0, active: true });
    expect(s.id).toBeTruthy();
  });

  it('rename and change brand carry the items along; names made by Add item follow', async () => {
    const o = await owner(app);
    await http().post('/api/items').set(auth(o)).send({ name: 'SW · HAVELLS CORAL', group: 'SW', brand: 'HAVELLS', series: 'CORAL', purchase: '30', openingQty: '10' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'Havells switch (hand-typed)', group: 'SW', brand: 'HAVELLS', series: 'PEARL' }).expect(201);
    const brands = (await http().get('/api/brands').set(auth(o)).expect(200)).body as Row[];
    const nor = await http().post('/api/brands').set(auth(o)).send({ name: 'Norwood' }).expect(201);
    // rename the brand: its id stays, the made-up name follows, the hand-typed one is left alone
    await http().patch(`/api/brands/${find(brands, 'HAVELLS').id}`).set(auth(o)).send({ name: 'Havells India' }).expect(200);
    expect((await http().patch(`/api/brands/${nor.body.id}`).set(auth(o)).send({ name: 'havells india' }).expect(409)).body.message).toBe('A brand called havells india already exists.');
    let items = (await http().get('/api/items').set(auth(o)).expect(200)).body as { name: string; brand: string; series: string }[];
    expect(items.map((i) => `${i.name} | ${i.brand}`).sort()).toEqual(['Havells switch (hand-typed) | Havells India', 'SW · Havells India CORAL | Havells India']);
    // rename a series typed on items: it is saved here, its items get the new series
    const coral = find((await http().get('/api/brand-series').set(auth(o)).expect(200)).body, 'CORAL');
    const r = await http().patch('/api/brand-series').set(auth(o)).send({ from: { brandId: coral.brandId, name: 'CORAL' }, name: 'Coral Plus', size: '6A-10A' }).expect(200);
    items = (await http().get('/api/items').set(auth(o)).expect(200)).body;
    expect(items.find((i) => i.series === 'Coral Plus')!.name).toBe('SW · Havells India Coral Plus');
    // change brand: the items move too
    await http().patch(`/api/brand-series/${r.body.id}`).set(auth(o)).send({ brandId: nor.body.id }).expect(200);
    items = (await http().get('/api/items').set(auth(o)).expect(200)).body;
    expect(items.find((i) => i.series === 'Coral Plus')).toMatchObject({ name: 'SW · Norwood Coral Plus', brand: 'Norwood' });
    const series = (await http().get('/api/brand-series').set(auth(o)).expect(200)).body as Row[];
    expect(find(series, 'Coral Plus')).toMatchObject({ brand: 'Norwood', size: '6A-10A', items: 1, stock: '10.000' });
    // a series name already on the target brand is refused
    const p = find(series, 'PEARL');
    expect((await http().patch('/api/brand-series').set(auth(o)).send({ from: { brandId: p.brandId, name: 'PEARL' }, name: 'pearl', brandId: nor.body.id }).expect(200)).body.name).toBe('pearl');
    expect((await http().post('/api/brand-series').set(auth(o)).send({ brandId: nor.body.id, name: 'Coral plus' }).expect(409)).body.message).toBe('Norwood already has a series called Coral plus.');
    // the audit log has the create and the renames
    const audit = (await http().get('/api/audit?limit=100').set(auth(o)).expect(200)).body as { action: string; entity: string; before: Record<string, unknown> | null; after: Record<string, unknown> }[];
    expect(audit.find((a) => a.entity === 'brand' && a.action === 'create' && a.after.name === 'Norwood')).toBeTruthy();
    expect(audit.find((a) => a.entity === 'brand' && a.action === 'update')).toMatchObject({ before: { name: 'HAVELLS' }, after: { name: 'Havells India' } });
    expect(audit.find((a) => a.entity === 'brand_series' && a.action === 'update' && a.after.name === 'Coral Plus' && a.after.brand === 'Havells India')).toMatchObject({ before: { name: 'CORAL' } });
  });

  it('nothing is deleted: inactive brands stay listed, leave the Add item picker, and come back', async () => {
    const o = await owner(app);
    const b = await http().post('/api/brands').set(auth(o)).send({ name: 'Legrand' }).expect(201);
    await http().patch(`/api/brands/${b.body.id}`).set(auth(o)).send({ active: false }).expect(200);
    expect(find((await http().get('/api/brands').set(auth(o)).expect(200)).body, 'Legrand').active).toBe(false);
    expect((await http().get('/api/catalogue').set(auth(o)).expect(200)).body.brands.map((x: Row) => x.name)).not.toContain('Legrand');
    await http().patch(`/api/brands/${b.body.id}`).set(auth(o)).send({ active: true }).expect(200);
    expect(find((await http().get('/api/brands').set(auth(o)).expect(200)).body, 'Legrand').active).toBe(true);
    const s = await http().post('/api/brand-series').set(auth(o)).send({ brandId: b.body.id, name: 'Myrius' }).expect(201);
    await http().patch(`/api/brand-series/${s.body.id}`).set(auth(o)).send({ active: false }).expect(200);
    expect(find((await http().get('/api/brand-series').set(auth(o)).expect(200)).body, 'Myrius').active).toBe(false);
    await http().delete(`/api/brands/${b.body.id}`).set(auth(o)).expect(404);
  });

  it('billing staff can look but not change; another shop sees nothing', async () => {
    const o = await owner(app);
    const b = await http().post('/api/brands').set(auth(o)).send({ name: 'Polycab' }).expect(201);
    const staff = await member(app, o, 'billing_staff');
    await http().get('/api/brands').set(auth(staff)).expect(200);
    await http().get('/api/brand-series').set(auth(staff)).expect(200);
    await http().post('/api/brands').set(auth(staff)).send({ name: 'X' }).expect(403);
    await http().patch(`/api/brands/${b.body.id}`).set(auth(staff)).send({ name: 'Y' }).expect(403);
    await http().post('/api/brand-series').set(auth(staff)).send({ brandId: b.body.id, name: 'Z' }).expect(403);
    const other = await owner(app);
    expect((await http().get('/api/brands').set(auth(other)).expect(200)).body).toEqual([]);
    await http().patch(`/api/brands/${b.body.id}`).set(auth(other)).send({ name: 'Mine' }).expect(404);
  });
});

type Pick = { name: string; taken: boolean; itemId?: string };
describe('Add item › Series of one brand', () => {
  it('only that brand’s active series, from Brands & Series and from its items, once each whatever the capitals', async () => {
    const o = await owner(app);
    const hav = await http().post('/api/brands').set(auth(o)).send({ name: 'Havells' }).expect(201);
    const anc = await http().post('/api/brands').set(auth(o)).send({ name: 'Anchor' }).expect(201);
    await http().post('/api/brand-series').set(auth(o)).send({ brandId: hav.body.id, name: 'Coral' }).expect(201);
    await http().post('/api/brand-series').set(auth(o)).send({ brandId: anc.body.id, name: 'Roma' }).expect(201);
    const off = await http().post('/api/brand-series').set(auth(o)).send({ brandId: hav.body.id, name: 'Old line' }).expect(201);
    await http().patch(`/api/brand-series/${off.body.id}`).set(auth(o)).send({ active: false }).expect(200);
    // typed on items: CORAL (same as the saved Coral), Pearl twice in different capitals, an inactive series' name, and no series
    await http().post('/api/items').set(auth(o)).send({ name: 'SW · Havells CORAL', group: 'SW', brand: 'Havells', series: 'CORAL' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'SW · Havells Pearl', group: 'SW', brand: 'Havells', series: 'Pearl' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'Plate · Havells pearl', group: 'Plate', brand: 'Havells', series: 'pearl' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'SW · Havells old line', group: 'SW', brand: 'Havells', series: 'old line' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'LED 12W', brand: 'Havells' }).expect(201);
    const list = (await http().get(`/api/brands/${hav.body.id}/series`).set(auth(o)).expect(200)).body as Pick[];
    expect(list.map((s) => s.name)).toEqual(['Coral', 'Pearl']);
    expect(list.every((s) => !s.taken)).toBe(true);
  });

  it('marks the series this parent item already has with this brand (the save still refuses them)', async () => {
    const o = await owner(app);
    const hav = await http().post('/api/brands').set(auth(o)).send({ name: 'Havells' }).expect(201);
    await http().post('/api/brand-series').set(auth(o)).send({ brandId: hav.body.id, name: 'Coral' }).expect(201);
    const pearl = await http().post('/api/items').set(auth(o)).send({ name: 'Switch 6A · Havells Pearl', group: 'Switch 6A', brand: 'Havells', series: 'Pearl' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'Plate · Havells Coral', group: 'Plate', brand: 'Havells', series: 'Coral' }).expect(201);
    const list = (await http().get(`/api/brands/${hav.body.id}/series`).query({ group: 'switch 6a' }).set(auth(o)).expect(200)).body as Pick[];
    // the item that has it comes along, so Add item can open it
    expect(list).toEqual([{ name: 'Coral', taken: false }, { name: 'Pearl', taken: true, itemId: pearl.body.id }]);
    expect((await http().post('/api/items').set(auth(o)).send({ name: 'Switch 6A · Havells PEARL', group: 'Switch 6A', brand: 'Havells', series: 'PEARL' }).expect(409)).body.message)
      .toBe('Havells PEARL is already in this item. Enter a different series.');
    expect((await http().get('/api/items').set(auth(o)).expect(200)).body.filter((i: { group: string }) => i.group === 'Switch 6A')).toHaveLength(1);
  });

  it('a series added from Add item is a Brands & Series series: same duplicate rules, shows on that page', async () => {
    const o = await owner(app);
    const b = await http().post('/api/catalogue/brands').set(auth(o)).send({ name: 'Polycab' }).expect(201);
    await http().post('/api/brand-series').set(auth(o)).send({ brandId: b.body.id, name: 'Maxima' }).expect(201);
    expect((await http().post('/api/brand-series').set(auth(o)).send({ brandId: b.body.id, name: 'MAXIMA' }).expect(409)).body.message).toBe('Polycab already has a series called MAXIMA.');
    expect((await http().get(`/api/brands/${b.body.id}/series`).set(auth(o)).expect(200)).body).toEqual([{ name: 'Maxima', taken: false }]);
    expect((await http().get('/api/brand-series').set(auth(o)).expect(200)).body.map((s: Row) => `${s.brand} ${s.name}`)).toEqual(['Polycab Maxima']);
  });

  it('billing staff can look; another shop’s brand is not found', async () => {
    const o = await owner(app);
    const b = await http().post('/api/brands').set(auth(o)).send({ name: 'Wipro' }).expect(201);
    await http().post('/api/brand-series').set(auth(o)).send({ brandId: b.body.id, name: 'Garnet' }).expect(201);
    const staff = await member(app, o, 'billing_staff');
    expect((await http().get(`/api/brands/${b.body.id}/series`).set(auth(staff)).expect(200)).body).toEqual([{ name: 'Garnet', taken: false }]);
    const other = await owner(app);
    await http().get(`/api/brands/${b.body.id}/series`).set(auth(other)).expect(404);
    await http().post('/api/brand-series').set(auth(other)).send({ brandId: b.body.id, name: 'Mine' }).expect(400);
    await http().get('/api/brands/not-an-id/series').set(auth(o)).expect(400);
  });
});
