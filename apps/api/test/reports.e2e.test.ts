import fs from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, startApp } from './helpers';

/** Party reports, on the commission test shop imported from the prototype's backup. */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const FIX = path.resolve(__dirname, '../../../packages/importer/fixtures');

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

describe('party reports', () => {
  it('every statement closes on the party balance in the books; figures match the prototype', async () => {
    const o = await owner(app);
    await http().post('/api/imports').set(auth(o)).send({ fileName: 'c.json', backup: fs.readFileSync(path.join(FIX, 'commission-shop.backup.json'), 'utf8') }).expect(200);
    const parties = (await http().get('/api/parties').set(auth(o)).expect(200)).body as { id: string; name: string; balance: string }[];
    for (const p of parties) {
      const st = (await http().get(`/api/reports/statement/${p.id}`).set(auth(o)).expect(200)).body;
      expect(st.close, p.name).toBeCloseTo(Number(p.balance), 2);
      expect(st.open).toBe(0);
    }
    // Mehta Electricals this year, as the prototype shows it: 31,471.00 Dr, 9,721.60 Cr, closing 21,749.40 Dr, 2,174.00 overdue
    const mehta = parties.find((p) => p.name === 'Mehta Electricals')!;
    const st = (await http().get(`/api/reports/statement/${mehta.id}?from=2026-04-01&to=2027-03-31`).set(auth(o)).expect(200)).body;
    expect(st).toMatchObject({ dr: 31471, cr: 9721.6, close: 21749.4, overdue: 2174 });
    expect(st.rows.map((r: { kind: string; no: string }) => `${r.kind} ${r.no}`)).toEqual([
      'Opening balance —', 'Sale INV-0101', 'Payment received PI-0620', 'Sale INV-0107', 'Payment received PI-0626', 'Sale (cancelled) INV-0104', 'Credit note CN-0001', 'Credit note CN-0002', 'Payment received PI-0625',
    ]);
    // this month: opening carried forward
    const oct = (await http().get(`/api/reports/statement/${mehta.id}?from=2026-10-01&to=2026-10-31`).set(auth(o)).expect(200)).body;
    expect(oct).toMatchObject({ open: 27348, dr: 0, cr: 5598.6, close: 21749.4 });
    // sale / purchase by party: totals as the prototype's report
    const act = (await http().get('/api/reports/party-activity?from=2026-04-01&to=2027-03-31').set(auth(o)).expect(200)).body as { sale: number; sr: number; pur: number; pr: number; sn: number; pn: number }[];
    const T = (k: 'sale' | 'sr' | 'pur' | 'pr' | 'sn' | 'pn') => Math.round(act.reduce((a, x) => a + x[k], 0) * 100) / 100;
    expect([T('sn'), T('sale'), T('sr'), T('pn'), T('pur'), T('pr')]).toEqual([7, 9944, 598.6, 2, 27444, 325]);
    expect((await http().get('/api/reports/statement/not-a-uuid').set(auth(o))).status).toBe(400);
    expect((await http().get(`/api/reports/statement/${mehta.id}?from=1-4-2026`).set(auth(o))).status).toBe(400);
  });

  it('billing staff (no reports permission) cannot read them', async () => {
    const o = await owner(app);
    const s = await member(app, o, 'billing_staff');
    await http().get('/api/reports/all-parties').set(auth(s)).expect(403);
    await http().get('/api/reports/all-parties').set(auth(o)).expect(200);
  });
});
