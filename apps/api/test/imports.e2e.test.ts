import fs from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, member, owner, startApp } from './helpers';

const FIX = path.resolve(__dirname, '../../../packages/importer/fixtures');
const backup = (n: string) => fs.readFileSync(path.join(FIX, n), 'utf8');

let app: INestApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
const asShop = <T>(businessId: string, fn: (tx: PrismaClient) => Promise<T>) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.business_id', ${businessId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });

beforeAll(async () => {
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
});
afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

describe('POST /api/imports', () => {
  it('a dry run reports what would come in, and saves nothing', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports?dryRun=true').set(auth(o)).send({ fileName: 'fresh.json', backup: backup('fresh-shop.backup.json') }).expect(200);
    expect(res.body).toMatchObject({ dryRun: true, importId: null, counts: { parties: 4, items: 4, partiesWithOpeningBalance: 3 }, warnings: [] });
    expect(await asShop(o.businessId, (tx) => tx.party.count())).toBe(0);
  });

  it('imports a fresh shop’s backup into an empty shop, all in one go', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ fileName: 'fresh.json', backup: backup('fresh-shop.backup.json') }).expect(200);
    expect(res.body.importId).toBeTruthy();
    const got = await asShop(o.businessId, async (tx) => ({
      business: await tx.business.findFirstOrThrow(),
      parties: await tx.party.findMany({ include: { group: true, addresses: true }, orderBy: { name: 'asc' } }),
      items: await tx.item.findMany({ include: { unit: true, category: true, movements: true }, orderBy: { name: 'asc' } }),
      series: await tx.documentSeries.findFirstOrThrow({ where: { docType: 'invoice' } }),
      wholesale: await tx.priceList.findFirstOrThrow({ where: { name: 'Wholesale' }, include: { rules: { include: { partyGroup: true } } } }),
      runs: await tx.importRun.findMany(),
      audit: await tx.auditLog.findMany({ where: { entity: 'import' } }),
      settings: await tx.businessSettings.findFirstOrThrow(),
    }));
    expect(got.business).toMatchObject({ name: 'Gupta Electricals & Hardware', shortName: 'Gupta Electricals', gstin: '09AAGFG2231M1ZQ', city: 'Lucknow', pin: '226001' });
    expect(got.settings.gstEnabled).toBe(true);
    expect(got.series.nextNumber).toBe(101);
    expect(got.parties.map((p) => p.name)).toEqual(['Kanpur Cables Pvt Ltd', 'Mehta Electricals', 'Raju Electrician', 'Walk-in Ramesh']);
    const mehta = got.parties.find((p) => p.name === 'Mehta Electricals')!;
    expect(mehta.kind).toBe('customer');
    expect(mehta.group?.name).toBe('Wholesale customers');
    expect(mehta.openingBalance.toFixed(2)).toBe('25000.00');
    expect(mehta.openingDate?.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(mehta.addresses[0]).toMatchObject({ kind: 'billing', line: '12, Aminabad Market' });
    expect(got.parties.find((p) => p.name === 'Kanpur Cables Pvt Ltd')).toMatchObject({ kind: 'supplier', openingType: 'pay' });
    const wire = got.items.find((i) => i.code === 'CW15')!;
    expect(wire.unit?.code).toBe('COIL');
    expect(wire.category?.name).toBe('Wires & cables');
    expect(wire.salePrice.toFixed(2)).toBe('1890.00');
    expect(wire.movements).toHaveLength(1);
    expect(wire.movements[0]!.qty.toFixed(3)).toBe('25.000');
    expect(wire.movements[0]!.kind).toBe('opening');
    expect(got.items.find((i) => i.name === 'Fan installation')!.kind).toBe('service');
    expect(got.wholesale.rules.map((r) => r.partyGroup.name)).toEqual(['Wholesale customers']);
    expect(got.runs).toHaveLength(1);
    expect(got.runs[0]).toMatchObject({ status: 'done', fileName: 'fresh.json' });
    expect(got.audit).toHaveLength(1);

    // a second import would enter everything twice: refused
    const again = await http().post('/api/imports').set(auth(o)).send({ backup: backup('fresh-shop.backup.json') }).expect(409);
    expect(again.body.message).toMatch(/already has parties or items/);
    const list = await http().get('/api/imports').set(auth(o)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('a shop that kept the sample catalogue gets those items, without stock', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ backup: backup('fresh-kept-items.backup.json') }).expect(200);
    expect(res.body.counts.items).toBeGreaterThan(200);
    expect(await asShop(o.businessId, (tx) => tx.item.count())).toBe(res.body.counts.items);
    expect(await asShop(o.businessId, (tx) => tx.stockMovement.count())).toBe(0);
  });

  it('explains a wrong file in plain words', async () => {
    const o = await owner(app);
    const res = await http().post('/api/imports').set(auth(o)).send({ backup: '{"hello":1}' }).expect(422);
    expect(res.body.message).toMatch(/isn’t a backup from the Billing ERP app/);
  });

  it('only the owner can import', async () => {
    const o = await owner(app);
    const mgr = await member(app, o, 'manager');
    await http().post('/api/imports').set(auth(mgr)).send({ backup: backup('fresh-shop.backup.json') }).expect(403);
  });

  it('the imported books stay private to that shop', async () => {
    const a = await owner(app);
    const b = await owner(app);
    await http().post('/api/imports').set(auth(a)).send({ backup: backup('fresh-shop.backup.json') }).expect(200);
    expect(await asShop(b.businessId, (tx) => tx.party.count())).toBe(0);
    expect(await asShop(b.businessId, (tx) => tx.item.count())).toBe(0);
  });
});
