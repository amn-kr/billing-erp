import type { INestApplication } from '@nestjs/common';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService, afterCommit } from '../src/common/db.service';
import { auth, owner, startApp } from './helpers';

/**
 * Owner, 18 Nov 2026: document numbers come only from the app (never typed), and every open screen
 * hears when the next number has moved on, so it can show the new one without a tap.
 */
let app: INestApplication;
let port = 0;
const api = () => request(app.getHttpServer());
const D = '2026-10-04';
const TYPED = 'Numbers are given by the app. They can’t be typed.';

beforeAll(async () => {
  app = await startApp();
  await new Promise<void>((ok) => app.getHttpServer().listen(0, ok));
  port = (app.getHttpServer().address() as AddressInfo).port;
});
afterAll(async () => {
  await app.close();
});

type S = Awaited<ReturnType<typeof owner>>;
async function shop() {
  const o = await owner(app);
  const fan = (await api().post('/api/items').set(auth(o)).send({ name: 'Ceiling fan 1200mm', sale: '1890', purchase: '1560', gstRate: 18, openingQty: '25' }).expect(201)).body;
  const verma = (await api().post('/api/parties').set(auth(o)).send({ name: 'Verma Traders' }).expect(201)).body;
  const kc = (await api().post('/api/parties').set(auth(o)).send({ name: 'Kanpur Cables', kind: 'supplier' }).expect(201)).body;
  return { o, fan, verma, kc };
}
const line = (it: { id: string; name: string }, qty: string, price: string) => ({ itemId: it.id, name: it.name, qty, price, rate: price, discPct: '0', gstRate: '18' });

/** Listens to GET /api/live and collects the messages that arrive. */
function listen(o: S): Promise<{ got: { event: string; data: string }[]; stop: () => void }> {
  return new Promise((ok, fail) => {
    const got: { event: string; data: string }[] = [];
    const req = http.get({ port, path: '/api/live', headers: { ...auth(o), Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) return fail(new Error(`status ${res.statusCode}`));
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        buf += c;
        let cut: number;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const ev = /^event: ?(.*)$/m.exec(block)?.[1] ?? 'message';
          const data = /^data: ?(.*)$/m.exec(block)?.[1] ?? '';
          got.push({ event: ev, data });
        }
      });
      ok({ got, stop: () => req.destroy() });
    });
    req.on('error', () => undefined);
  });
}
const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

describe('numbers are given by the app only', () => {
  it('a new sale, purchase or quotation with a typed number is refused', async () => {
    const { o, fan, verma, kc } = await shop();
    const s = await api().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, number: 'INV-0500', lines: [line(fan, '1', '1890')] }).expect(400);
    expect(s.body).toMatchObject({ message: TYPED, field: 'number' });
    const p = await api().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: kc.id, number: 'PB-0500', lines: [line(fan, '1', '1500')] }).expect(400);
    expect(p.body.message).toBe(TYPED);
    // nothing was used up: the first real ones are still 0001
    expect((await api().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body.number).toBe('INV-0001');
    expect((await api().post('/api/purchases').set(auth(o)).send({ kind: 'bill', date: D, dueDate: D, partyId: kc.id, lines: [line(fan, '1', '1500')] }).expect(201)).body.number).toBe('PB-0001');
  });

  it('editing keeps the saved number; sending a different one is refused', async () => {
    const { o, fan, verma } = await shop();
    const r = (await api().post('/api/sales').set(auth(o)).send({ date: D, dueDate: D, partyId: verma.id, lines: [line(fan, '1', '1890')] }).expect(201)).body;
    const body = { date: D, dueDate: D, partyId: verma.id, lines: [line(fan, '2', '1890')] };
    expect((await api().put(`/api/sales/${r.id}`).set(auth(o)).send({ ...body, number: r.number }).expect(200)).body.number).toBe(r.number);
    expect((await api().put(`/api/sales/${r.id}`).set(auth(o)).send(body).expect(200)).body.number).toBe(r.number);
    await api().put(`/api/sales/${r.id}`).set(auth(o)).send({ ...body, number: 'INV-0900' }).expect(400);
  });
});

describe('live numbers', () => {
  it('open screens of the same shop hear that the next number moved on; other shops hear nothing', async () => {
    const a = await shop();
    const b = await shop();
    const la = await listen(a.o);
    const lb = await listen(b.o);
    try {
      await api().post('/api/sales').set(auth(a.o)).send({ date: D, dueDate: D, partyId: a.verma.id, lines: [line(a.fan, '1', '1890')] }).expect(201);
      await until(() => la.got.some((g) => g.event === 'numbers'));
      expect(la.got.filter((g) => g.event === 'numbers').map((g) => JSON.parse(g.data))).toEqual([{ docType: 'invoice' }]);
      expect(lb.got.filter((g) => g.event === 'numbers')).toEqual([]);
      expect((await api().get('/api/sales/next-number?kind=invoice').set(auth(a.o)).expect(200)).body.number).toBe('INV-0002');
    } finally {
      la.stop();
      lb.stop();
    }
  });

  it('news waits for the save to be kept, and is never sent for a save that was undone', async () => {
    const db = app.get(DbService);
    let ran = 0;
    await expect(db.scoped({}, async (tx) => { afterCommit(tx, () => ran++); throw new Error('undone'); })).rejects.toThrow('undone');
    expect(ran).toBe(0);
    await db.scoped({}, async (tx) => { afterCommit(tx, () => ran++); expect(ran).toBe(0); });
    expect(ran).toBe(1);
  });

  it('needs a signed-in shop member', async () => {
    await api().get('/api/live').expect(401);
  });
});
