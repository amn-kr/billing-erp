import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

describe('parties', () => {
  it('add, list, search, edit and archive — with the prototype’s checks', async () => {
    const o = await owner(app);
    const res = await http().post('/api/parties').set(auth(o)).send({
      name: 'Mehta Electricals', phone: '94150 12345', group: 'Wholesale customers', gstin: '09aajpm7745q1z2', email: 'mehta@example.com',
      billing: { line: '12, Aminabad Market', city: 'Lucknow', pin: '226018', state: '09' }, openingBalance: '25,000', openingDate: '2026-04-01', creditDays: 30,
      contacts: [{ label: 'Contact person', value: 'Suresh' }],
    }).expect(201);
    expect(res.body).toMatchObject({ name: 'Mehta Electricals', kind: 'customer', phone: '9415012345', gstin: '09AAJPM7745Q1Z2', group: 'Wholesale customers', openingBalance: '25000.00', openingType: 'receive', balance: '25000.00', creditDays: 30, creditLimit: null });
    expect(res.body.billing).toMatchObject({ city: 'Lucknow', pin: '226018' });
    expect(res.body.contacts).toEqual([{ label: 'Contact person', value: 'Suresh' }]);

    const sup = await http().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier', openingBalance: '48000' }).expect(201);
    expect(sup.body).toMatchObject({ openingType: 'pay', balance: '-48000.00' });

    const dup = await http().post('/api/parties').set(auth(o)).send({ name: 'mehta electricals' }).expect(409);
    expect(dup.body.message).toBe('A party with this name already exists.');
    expect((await http().post('/api/parties').set(auth(o)).send({ name: 'X', phone: '12345' }).expect(400)).body.message).toBe('Enter a 10-digit mobile number.');
    expect((await http().post('/api/parties').set(auth(o)).send({ name: 'X', gstin: '09BAD' }).expect(400)).body.message).toBe('GSTIN has 15 characters, like 09AAJPM7745Q1Z2.');
    expect((await http().post('/api/parties').set(auth(o)).send({ name: '' }).expect(400)).body.message).toBe('Enter the party name.');

    const list = await http().get('/api/parties?q=9415').set(auth(o)).expect(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Mehta Electricals']);
    expect((await http().get('/api/parties?kind=supplier').set(auth(o)).expect(200)).body).toHaveLength(1);

    const upd = await http().patch(`/api/parties/${res.body.id}`).set(auth(o)).send({ creditLimit: '50,000', group: 'Contractors' }).expect(200);
    expect(upd.body).toMatchObject({ creditLimit: '50000.00', group: 'Contractors' });

    await http().post(`/api/parties/${res.body.id}/archive`).set(auth(o)).expect(200);
    expect((await http().get('/api/parties').set(auth(o)).expect(200)).body).toHaveLength(1);
    expect((await http().get('/api/parties?archived=true').set(auth(o)).expect(200)).body).toHaveLength(1);
    // an archived name can be reused, but then the old one can't come back until renamed
    await http().post('/api/parties').set(auth(o)).send({ name: 'Mehta Electricals' }).expect(201);
    expect((await http().post(`/api/parties/${res.body.id}/restore`).set(auth(o)).expect(409)).body.message).toMatch(/already exists/);

    const groups = await http().get('/api/party-groups').set(auth(o)).expect(200);
    expect(groups.body.find((g: { name: string }) => g.name === 'Contractors').parties).toBe(0);
  });

  it('billing staff can look but not change; another shop sees nothing', async () => {
    const o = await owner(app);
    const p = await http().post('/api/parties').set(auth(o)).send({ name: 'Raju Electrician' }).expect(201);
    const staff = await member(app, o, 'billing_staff');
    await http().get('/api/parties').set(auth(staff)).expect(200);
    await http().post('/api/parties').set(auth(staff)).send({ name: 'New' }).expect(403);
    await http().patch(`/api/parties/${p.body.id}`).set(auth(staff)).send({ name: 'Y' }).expect(403);
    const other = await owner(app);
    expect((await http().get('/api/parties').set(auth(other)).expect(200)).body).toEqual([]);
    await http().get(`/api/parties/${p.body.id}`).set(auth(other)).expect(404);
  });
});

describe('items and stock', () => {
  it('an item with opening stock; low-stock level; price history on edit', async () => {
    const o = await owner(app);
    const wire = await http().post('/api/items').set(auth(o)).send({
      name: 'Copper wire 1.5 sq mm (90 m)', code: 'CW15', hsn: '8544', unit: 'coil', category: 'Wires & cables', brand: 'Finolex', gstRate: 18,
      sale: '1,890', purchase: '1560', mrp: '2350', minStock: '10', location: 'Rack A1', openingQty: '25', openingRate: '1540', openingDate: '2026-04-01',
    }).expect(201);
    expect(wire.body).toMatchObject({ unit: 'COIL', brand: 'Finolex', sale: '1890.00', stock: '25.000', level: 'ok', gstRate: '18.00' });
    expect((await http().post('/api/items').set(auth(o)).send({ name: 'Other', code: 'cw15' }).expect(409)).body.message).toBe('This item code is already used.');
    expect((await http().post('/api/items').set(auth(o)).send({ name: 'copper wire 1.5 sq mm (90 m)' }).expect(409)).body.message).toBe('An item with this name already exists.');
    expect((await http().post('/api/items').set(auth(o)).send({ name: 'Bad', hsn: '12' }).expect(400)).body.message).toBe('HSN/SAC is 4 to 8 digits.');
    const svc = await http().post('/api/items').set(auth(o)).send({ name: 'Fan installation', kind: 'service', sale: '350' }).expect(201);
    expect(svc.body).toMatchObject({ stock: null, level: 'ok', unit: 'PCS' });

    await http().patch(`/api/items/${wire.body.id}`).set(auth(o)).send({ sale: '1950' }).expect(200);
    const hist = await http().get(`/api/prices/history?itemId=${wire.body.id}`).set(auth(o)).expect(200);
    expect(hist.body[0]).toMatchObject({ field: 'sale', oldValue: '1890.00', newValue: '1950.00', how: 'Edited item' });

    // reduce below minimum → low; reduce to zero → out
    const adj = await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: wire.body.id, mode: 'reduce', qty: 18, date: '2026-10-01', reason: 'Physical count correction' }).expect(201);
    expect(adj.body).toMatchObject({ number: 'ADJ-0001', stock: '7.000' });
    expect((await http().get('/api/items?level=low').set(auth(o)).expect(200)).body.map((i: { name: string }) => i.name)).toEqual(['Copper wire 1.5 sq mm (90 m)']);
    expect((await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: wire.body.id, mode: 'reduce', qty: 8, date: '2026-10-01' }).expect(400)).body.message).toBe('Only 7.000 in stock. You can’t reduce by more than that.');
    await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: svc.body.id, mode: 'add', qty: 1, date: '2026-10-01' }).expect(400);

    // cancel puts it back; numbers keep counting
    await http().post(`/api/stock-adjustments/${adj.body.id}/cancel`).set(auth(o)).expect(204);
    await http().post(`/api/stock-adjustments/${adj.body.id}/cancel`).set(auth(o)).expect(400);
    const detail = await http().get(`/api/items/${wire.body.id}`).set(auth(o)).expect(200);
    expect(detail.body.stock).toBe('25.000');
    expect(detail.body.movements.map((m: { kind: string; qty: string }) => `${m.kind} ${m.qty}`)).toEqual(expect.arrayContaining(['opening 25.000', 'adjustment -18.000', 'cancel 18.000']));
    const adj2 = await http().post('/api/stock-adjustments').set(auth(o)).send({ itemId: wire.body.id, mode: 'add', qty: 5, date: '2026-10-02' }).expect(201);
    expect(adj2.body.number).toBe('ADJ-0002');
    const list = await http().get('/api/stock-adjustments').set(auth(o)).expect(200);
    expect(list.body.map((a: { number: string; cancelled: boolean }) => `${a.number}${a.cancelled ? ' cancelled' : ''}`)).toEqual(['ADJ-0002', 'ADJ-0001 cancelled']);

    const cat = await http().get('/api/catalogue').set(auth(o)).expect(200);
    expect(cat.body.units.find((u: { code: string }) => u.code === 'COIL').items).toBe(1);
    expect(cat.body.brands).toEqual([expect.objectContaining({ name: 'Finolex', items: 1 })]);
  });

  it('godowns and transfers', async () => {
    const o = await owner(app);
    const it = await http().post('/api/items').set(auth(o)).send({ name: 'LED bulb 9W', purchase: '62', openingQty: '200' }).expect(201);
    const g = await http().post('/api/godowns').set(auth(o)).send({ name: 'Aminabad godown', manager: 'Ravi Yadav', phone: '98222 33344' }).expect(201);
    await http().post('/api/godowns').set(auth(o)).send({ name: 'aminabad godown' }).expect(409);
    const main = (await http().get('/api/godowns').set(auth(o)).expect(200)).body.find((x: { isDefault: boolean }) => x.isDefault);
    expect(main).toMatchObject({ name: 'Main shop', items: 1, value: '12400.00' });
    const t = await http().post('/api/stock-transfers').set(auth(o)).send({ itemId: it.body.id, fromGodownId: main.id, toGodownId: g.body.id, qty: 50, date: '2026-10-01' }).expect(201);
    expect(t.body.number).toBe('TRF-0001');
    expect((await http().post('/api/stock-transfers').set(auth(o)).send({ itemId: it.body.id, fromGodownId: g.body.id, toGodownId: g.body.id, qty: 1, date: '2026-10-01' }).expect(400)).body.message).toBe('Choose two different godowns.');
    const d = await http().get(`/api/items/${it.body.id}`).set(auth(o)).expect(200);
    expect(d.body.stock).toBe('200.000');
    expect(d.body.godowns.map((x: { name: string; stock: string }) => `${x.name} ${x.stock}`).sort()).toEqual(['Aminabad godown 50.000', 'Main shop 150.000']);
    expect((await http().post(`/api/godowns/${g.body.id}/archive`).set(auth(o)).expect(400)).body.message).toMatch(/still has stock/);
    expect((await http().post(`/api/godowns/${main.id}/archive`).set(auth(o)).expect(400)).body.message).toMatch(/main godown/);
    await http().post(`/api/stock-transfers/${t.body.id}/cancel`).set(auth(o)).expect(204);
    await http().post(`/api/godowns/${g.body.id}/archive`).set(auth(o)).expect(204);
  });
});

describe('price lists and prices', () => {
  it('rules, fixed prices and bulk changes, matching the prototype’s maths', async () => {
    const o = await owner(app);
    const it = await http().post('/api/items').set(auth(o)).send({ name: 'Copper wire', sale: '1890', purchase: '1560' }).expect(201);
    const lists = await http().get('/api/price-lists').set(auth(o)).expect(200);
    const wholesale = lists.body.find((l: { name: string }) => l.name === 'Wholesale');
    expect(wholesale).toMatchObject({ rule: 'disc', value: '8', roundTo: '1', active: true, groups: ['Wholesale customers'] });
    let prices = await http().get('/api/prices').set(auth(o)).expect(200);
    expect(prices.body.lists.map((l: { name: string }) => l.name)).toEqual(['Retail price', 'Wholesale']);
    expect(prices.body.items[0].lists[wholesale.id]).toEqual({ price: '1739.00', fixed: false });

    await http().put(`/api/price-lists/${wholesale.id}/items/${it.body.id}`).set(auth(o)).send({ price: 1720 }).expect(204);
    prices = await http().get('/api/prices').set(auth(o)).expect(200);
    expect(prices.body.items[0].lists[wholesale.id]).toEqual({ price: '1720.00', fixed: true });
    await http().put(`/api/price-lists/${wholesale.id}/items/${it.body.id}`).set(auth(o)).send({ price: null }).expect(204);

    const cost = await http().post('/api/price-lists').set(auth(o)).send({ name: 'Project rate', rule: 'mark', value: 12, roundTo: 10, groups: ['Contractors'] }).expect(201);
    expect(cost.body).toMatchObject({ groups: ['Contractors'], active: true });
    prices = await http().get('/api/prices').set(auth(o)).expect(200);
    expect(prices.body.items[0].lists[cost.body.id].price).toBe('1750.00');
    await http().post('/api/price-lists').set(auth(o)).send({ name: 'project rate', rule: 'disc', value: 1 }).expect(409);
    const retail = lists.body.find((l: { isDefault: boolean }) => l.isDefault);
    expect((await http().patch(`/api/price-lists/${retail.id}`).set(auth(o)).send({ active: false }).expect(400)).body.message).toMatch(/can’t be switched off/);

    const ch = await http().post('/api/prices/changes').set(auth(o)).send({ how: 'Sale price +5%, rounded to ₹1', changes: [{ itemId: it.body.id, field: 'sale', value: 1985 }, { itemId: it.body.id, field: 'mrp', value: 0 }] }).expect(200);
    expect(ch.body.changed).toBe(1);
    const h = await http().get('/api/prices/history').set(auth(o)).expect(200);
    expect(h.body[0]).toMatchObject({ field: 'sale', oldValue: '1890.00', newValue: '1985.00', how: 'Sale price +5%, rounded to ₹1', by: 'Ravi Gupta' });
  });
});

describe('settings and commission', () => {
  it('owner changes settings; accountant cannot', async () => {
    const o = await owner(app);
    const s = await http().get('/api/settings').set(auth(o)).expect(200);
    expect(s.body.gstEnabled).toBe(true);
    expect(s.body.taxes).toHaveLength(16);
    const u = await http().patch('/api/settings').set(auth(o)).send({ gstEnabled: false, data: { upi: 'gupta@okhdfcbank', payQr: true } }).expect(200);
    expect(u.body).toMatchObject({ gstEnabled: false, data: { upi: 'gupta@okhdfcbank', payQr: true, showCurrency: false } });
    const acc = await member(app, o, 'accountant');
    await http().patch('/api/settings').set(auth(acc)).send({ gstEnabled: true }).expect(403);
    await http().patch('/api/settings').set(auth(o)).send({ data: { nested: { x: 1 } } }).expect(400);
  });

  it('electricians and commission rules', async () => {
    const o = await owner(app);
    const r = await http().post('/api/referrers').set(auth(o)).send({ name: 'Raju Electrician', phone: '98390 11223', city: 'Lucknow' }).expect(201);
    expect(r.body.phone).toBe('9839011223');
    expect((await http().get('/api/referrers').set(auth(o)).expect(200)).body).toHaveLength(1);
    const rules = await http().get('/api/commission-rules').set(auth(o)).expect(200);
    expect(rules.body.find((x: { category: string }) => x.category === 'Fans')).toMatchObject({ kind: 'percent', value: '8' });
    await http().put('/api/commission-rules').set(auth(o)).send({ category: 'Fans', kind: 'fixed', value: 25 }).expect(200);
    await http().put('/api/commission-rules').set(auth(o)).send({ category: 'Solar', kind: 'percent', value: 4 }).expect(200);
    const after = await http().get('/api/commission-rules').set(auth(o)).expect(200);
    expect(after.body.find((x: { category: string }) => x.category === 'Fans')).toMatchObject({ kind: 'fixed', value: '25' });
    expect(after.body.find((x: { category: string }) => x.category === 'Solar')).toMatchObject({ kind: 'percent', value: '4' });
  });
});
