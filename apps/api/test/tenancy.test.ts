import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { DEFAULT_ROLE_PERMISSIONS } from '@billing/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DB } from './env';
import { auth, owner, startApp } from './helpers';

/** Row-level security: one shop can never see or touch another shop's rows — checked in Postgres itself. */
let app: INestApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
const asShop = <T>(businessId: string | null, fn: (tx: PrismaClient) => Promise<T>) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.business_id', ${businessId ?? ''}, true), set_config('app.user_id', '', true), set_config('app.user_email', '', true)`;
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

describe('row-level security (as the app database role)', () => {
  it('a shop sees only its own rows', async () => {
    const a = await owner(app);
    const b = await owner(app);
    const seenByA = await asShop(a.businessId, (tx) => tx.business.findMany());
    expect(seenByA.map((x) => x.id)).toEqual([a.businessId]);
    expect(await asShop(a.businessId, (tx) => tx.business.findUnique({ where: { id: b.businessId } }))).toBeNull();
    const rates = await asShop(a.businessId, (tx) => tx.taxRate.findMany());
    expect(rates.every((r) => r.businessId === a.businessId)).toBe(true);
    expect(rates).toHaveLength(7);
    const audit = await asShop(a.businessId, (tx) => tx.auditLog.findMany());
    expect(audit.every((r) => r.businessId === a.businessId)).toBe(true);
  });
  it('without a shop context nothing is visible', async () => {
    await owner(app);
    expect(await asShop(null, (tx) => tx.business.count())).toBe(0);
    expect(await asShop(null, (tx) => tx.membership.count())).toBe(0);
    expect(await asShop(null, (tx) => tx.auditLog.count())).toBe(0);
  });
  it('cannot write rows into another shop', async () => {
    const a = await owner(app);
    const b = await owner(app);
    await expect(
      asShop(a.businessId, (tx) => tx.taxRate.create({ data: { businessId: b.businessId, name: 'Sneaky', rate: '1', createdBy: b.businessId } })),
    ).rejects.toThrow(/row-level security/);
    const n = await asShop(a.businessId, (tx) => tx.business.updateMany({ where: { id: b.businessId }, data: { city: 'Hacked' } }));
    expect(n.count).toBe(0);
  });
  it('the app role can never delete, and the audit log cannot be edited', async () => {
    const a = await owner(app);
    await expect(asShop(a.businessId, (tx) => tx.taxRate.deleteMany({}))).rejects.toThrow(/permission denied/);
    await expect(asShop(a.businessId, (tx) => tx.auditLog.updateMany({ data: { action: 'x' } }))).rejects.toThrow(/permission denied/);
    await expect(db.user.deleteMany({})).rejects.toThrow(/permission denied/);
  });
  it('through the API, one shop cannot reach another', async () => {
    const a = await owner(app);
    const b = await owner(app);
    const res = await http().get('/api/businesses/current').set(auth(a)).expect(200);
    expect(res.body.id).toBe(a.businessId);
    const members = await http().get('/api/members').set(auth(a)).expect(200);
    expect(members.body.members.map((m: { email: string }) => m.email)).toEqual([a.email]);
    expect(b.businessId).not.toBe(a.businessId);
  });
});

describe('system roles in the database', () => {
  it('match DEFAULT_ROLE_PERMISSIONS in packages/shared', async () => {
    const roles = await asShop(null, (tx) => tx.role.findMany({ where: { businessId: null }, include: { permissions: true } }));
    const fromDb = Object.fromEntries(roles.map((r) => [r.key, r.permissions.map((p) => p.permission).sort()]));
    const expected = Object.fromEntries(Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([k, v]) => [k, [...v].sort()]));
    expect(fromDb).toEqual(expected);
  });
});
