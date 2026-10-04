import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, todayIst } from '@billing/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, SHOP, signUp, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

describe('POST /api/businesses (set up your shop)', () => {
  it('creates the shop with the person as owner and a 14-day trial', async () => {
    const o = await owner(app);
    const me = await http().get('/api/me').set(auth(o)).expect(200);
    expect(me.body.business).toMatchObject({ name: SHOP.name, short: 'Gupta Electricals', plan: 'trial', gstEnabled: true, state: '09' });
    expect(me.body.business.code).toMatch(/^BE-\d{4,}$/);
    expect(me.body.business.planEndsOn).toBe(addDays(todayIst(), 14));
    expect(me.body.role).toBe('owner');
    expect(me.body.permissions).toContain('members.manage');
    expect(me.body.user.name).toBe('Ravi Gupta');
  });
  it('sets up the financial year, numbering and GST rates', async () => {
    const o = await owner(app, { ...SHOP, inv: '415' } as typeof SHOP);
    const cur = await http().get('/api/businesses/current').set(auth(o)).expect(200);
    expect(cur.body.settings.gstEnabled).toBe(true);
  });
  it('without a GSTIN, GST is off', async () => {
    const o = await owner(app, { name: 'Patel Kirana', owner: 'Mehul Patel', state: '24' } as typeof SHOP);
    const me = await http().get('/api/me').set(auth(o)).expect(200);
    expect(me.body.business.gstEnabled).toBe(false);
    expect(me.body.business.short).toBe('Patel Kirana');
  });
  it('uses the website’s wording for mistakes', async () => {
    const s = await signUp(app);
    const r1 = await http().post('/api/businesses').set(auth(s)).send({ ...SHOP, state: '27' }).expect(400);
    expect(r1.body.message).toBe('GSTIN starts with 09 — choose that state.');
    const r2 = await http().post('/api/businesses').set(auth(s)).send({ ...SHOP, pin: '123' }).expect(400);
    expect(r2.body.message).toBe('PIN code has 6 digits.');
    const r3 = await http().post('/api/businesses').set(auth(s)).send({ ...SHOP, name: '' }).expect(400);
    expect(r3.body.message).toBe('Enter your business name.');
  });
});

describe('GET/PATCH /api/businesses/current', () => {
  it('needs a shop', async () => {
    const s = await signUp(app);
    const res = await http().get('/api/businesses/current').set(auth(s)).expect(403);
    expect(res.body.message).toBe('Set up or choose a shop first.');
  });
  it('owner can update details; billing staff cannot', async () => {
    const o = await owner(app);
    const res = await http().patch('/api/businesses/current').set(auth(o)).send({ city: 'Kanpur' }).expect(200);
    expect(res.body.city).toBe('Kanpur');
    const staff = await member(app, o, 'billing_staff');
    const r2 = await http().patch('/api/businesses/current').set(auth(staff)).send({ city: 'Agra' }).expect(403);
    expect(r2.body.message).toBe('Your role does not allow this. Ask the shop owner.');
  });
  it('validates updates', async () => {
    const o = await owner(app);
    await http().patch('/api/businesses/current').set(auth(o)).send({ pin: '12' }).expect(400);
  });
});

describe('POST /api/businesses/switch', () => {
  it('switches between your own shops', async () => {
    const o = await owner(app);
    const second = await http().post('/api/businesses').set(auth(o)).send({ name: 'Sharma Paints', owner: 'Ravi Gupta', state: '09', city: 'Kanpur' }).expect(201);
    const me2 = await http().get('/api/me').set('Authorization', `Bearer ${second.body.accessToken}`).expect(200);
    expect(me2.body.business.name).toBe('Sharma Paints');
    expect(me2.body.memberships).toHaveLength(2);
    const sw = await http().post('/api/businesses/switch').set('Authorization', `Bearer ${second.body.accessToken}`).send({ businessId: o.businessId }).expect(201);
    const me1 = await http().get('/api/me').set('Authorization', `Bearer ${sw.body.accessToken}`).expect(200);
    expect(me1.body.business.id).toBe(o.businessId);
  });
  it('refuses a shop you are not in', async () => {
    const a = await owner(app);
    const b = await owner(app);
    const res = await http().post('/api/businesses/switch').set(auth(a)).send({ businessId: b.businessId }).expect(403);
    expect(res.body.message).toBe('You are not a member of that shop.');
  });
});

describe('business details and start fresh', () => {
  it('saves short name, email, owner, next invoice number; GSTIN must match the state and turns GST on', async () => {
    const o = await owner(app);
    await http().patch('/api/settings').set(auth(o)).send({ gstEnabled: false }).expect(200);
    await http().patch('/api/businesses/current').set(auth(o)).send({ gstin: '27ABCPS4821K1Z6' }).expect(400);
    await http().patch('/api/businesses/current').set(auth(o)).send({ name: 'Gupta Electricals & Hardware', short: 'Gupta Elec', email: 'shop@gupta.example.com', owner: 'Ravi K Gupta', inv: '415', gstin: '09ABCPS4821K1Z6', state: '09' }).expect(200);
    const cur = (await http().get('/api/businesses/current').set(auth(o)).expect(200)).body;
    expect(cur).toMatchObject({ shortName: 'Gupta Elec', email: 'shop@gupta.example.com', ownerName: 'Ravi K Gupta', invoiceNext: 415 });
    expect((await http().get('/api/settings').set(auth(o)).expect(200)).body.gstEnabled).toBe(true);
    await http().patch('/api/businesses/current').set(auth(o)).send({ email: 'not-an-email' }).expect(400);
  });

  it('start fresh makes new, empty books and keeps the old ones; the item list can come along without stock', async () => {
    const o = await owner(app);
    await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', sale: '95', purchase: '62', openingQty: 40, openingRate: 62, openingDate: '2026-10-01' }).expect(201);
    const res = await http().post('/api/businesses').set(auth(o)).send({ name: 'Gupta Traders', owner: 'Ravi Gupta', state: '09', keepItems: true, cash: '2500' }).expect(201);
    const fresh = { token: res.body.accessToken };
    const items = (await http().get('/api/items').set(auth(fresh)).expect(200)).body;
    expect(items.map((i: { name: string; sale: string; stock: string | null }) => [i.name, i.sale, Number(i.stock)])).toEqual([['LED bulb 9W', '95.00', 0]]);
    expect((await http().get('/api/settings').set(auth(fresh)).expect(200)).body.data.cashOpen).toBe('2500');
    // the old books are untouched
    expect((await http().get('/api/items').set(auth(o)).expect(200)).body[0].stock).toBe('40.000');
    await http().post('/api/businesses').set(auth(o)).send({ name: 'X', owner: 'Y', state: '09', cash: 'lots' }).expect(400);
  });
});

