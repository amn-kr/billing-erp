import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type Grid = { rows: { id: string; n: string; c: string; grp?: string }[]; ser: { id: string; b: string; r: string; f: string }[] };
const grid = async (o: { token: string }) => (await http().get('/api/quote-grid').set(auth(o)).expect(200)).body as Grid;

describe('Quotation grid: the shop’s own brands, series and items only', () => {
  it('a new shop has no sample rows or columns', async () => {
    const o = await owner(app);
    expect(await grid(o)).toEqual({ rows: [], ser: [] });
  });

  it('columns: active series of active brands (series typed on items too); rows: parent items', async () => {
    const o = await owner(app);
    const hav = (await http().post('/api/brands').set(auth(o)).send({ name: 'Havells' }).expect(201)).body;
    const leg = (await http().post('/api/brands').set(auth(o)).send({ name: 'Legrand' }).expect(201)).body;
    const coral = (await http().post('/api/brand-series').set(auth(o)).send({ brandId: hav.id, name: 'Coral' }).expect(201)).body;
    await http().post('/api/brand-series').set(auth(o)).send({ brandId: leg.id, name: 'Myrius' }).expect(201);
    const adiva = (await http().post('/api/brand-series').set(auth(o)).send({ brandId: hav.id, name: 'Adiva' }).expect(201)).body;
    await http().post('/api/items').set(auth(o)).send({ name: 'SW · Anchor Roma', group: 'Modular switch 6A', brand: 'Anchor', series: 'Roma', sale: '38' }).expect(201);
    await http().post('/api/items').set(auth(o)).send({ name: 'Plate 2M · Havells Coral', group: 'Plate 2M', brand: 'Havells', series: 'Coral', sale: '55' }).expect(201);
    // inactive brand and inactive series are hidden
    await http().patch(`/api/brands/${leg.id}`).set(auth(o)).send({ active: false }).expect(200);
    await http().patch(`/api/brand-series/${adiva.id}`).set(auth(o)).send({ active: false }).expect(200);
    const g = await grid(o);
    expect(g.ser.map((s) => `${s.b} ${s.r}`)).toEqual(['Anchor Roma', 'Havells Coral']);
    expect(g.ser.find((s) => s.r === 'Coral')!.id).toBe(coral.id);
    expect(g.rows.map((r) => `${r.n}:${r.c}`)).toEqual(['Modular switch 6A:acc', 'Plate 2M:plate']);
    // a series typed on items keeps its column id when it is changed on Brands & Series
    const roma = g.ser.find((s) => s.r === 'Roma')!;
    const anchorId = (await http().get('/api/brands').set(auth(o)).expect(200)).body.find((b: { name: string }) => b.name === 'Anchor').id;
    await http().patch('/api/brand-series').set(auth(o)).send({ from: { brandId: anchorId, name: 'Roma' }, name: 'Roma Plus' }).expect(200);
    expect((await grid(o)).ser.find((s) => s.id === roma.id)!.r).toBe('Roma Plus');
  });

  it('a saved grid is kept; its ranges show only when their brand is on Brands & Series', async () => {
    const o = await owner(app);
    const saved: Grid = {
      rows: [{ id: 'r1', n: 'Bell switch 1M', c: 'acc' }, { id: 'p1', n: 'Plate 1/2M', c: 'plate' }],
      ser: [{ id: 's1', b: 'Havells', r: 'Coral', f: 'White' }, { id: 's3', b: 'Legrand', r: 'Myrius', f: 'White' }],
    };
    await http().put('/api/quote-grid').set(auth(o)).send(saved).expect(200);
    // a quotation saved on that grid
    const q = (await http().post('/api/quotations/brand').set(auth(o)).send({ date: '2026-10-01', cust: 'Sunil', sel: ['s1', 's3'], qty: { r1: 5, p1: 2 }, items: 2, pcs: 7, low: null }).expect(201)).body;
    // no brands yet: the saved ranges are hidden (not deleted), the rows stay
    let g = await grid(o);
    expect(g.ser).toEqual([]);
    expect(g.rows.map((r) => r.id)).toEqual(['r1', 'p1']);
    // Havells on Brands & Series: its saved range shows again, with its old id
    await http().post('/api/brands').set(auth(o)).send({ name: 'havells' }).expect(201);
    g = await grid(o);
    expect(g.ser).toEqual([{ id: 's1', b: 'Havells', r: 'Coral', f: 'White' }]);
    // the saved quotation still has its quantities and ranges
    const doc = (await http().get(`/api/sales/${q.id}`).set(auth(o)).expect(200)).body;
    expect(doc.extra).toMatchObject({ sel: ['s1', 's3'], qty: { r1: 5, p1: 2 } });
  });

  it('+ Add item row keeps the row in the saved grid, with an audit entry', async () => {
    const o = await owner(app);
    const row = (await http().post('/api/quote-grid/rows').set(auth(o)).send({ n: 'Bell push', c: 'acc' }).expect(201)).body;
    expect((await http().post('/api/quote-grid/rows').set(auth(o)).send({ n: 'bell push', c: 'acc' }).expect(400)).body.message).toBe('This item is already in the list.');
    expect((await grid(o)).rows).toEqual([{ id: row.id, n: 'Bell push', c: 'acc' }]);
    const audit = (await http().get('/api/audit?limit=20').set(auth(o)).expect(200)).body as { entity: string; after: { rows?: unknown[] } }[];
    expect(audit.find((a) => a.entity === 'quote_grid')!.after.rows).toHaveLength(1);
  });
});
