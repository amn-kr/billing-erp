/**
 * Owner panel, part 1 (owner's request, 1 Nov 2026): the software owner (a separate super_admins table) signs in
 * on the shared sign-in page, gets panel tokens that no shop route accepts (and the reverse), a lock after wrong
 * passwords, one-time setup, the customers list and Suspend / Reactivate. Everything is in owner_audit_log.
 */
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cookieOf, member, owner, signUp, startApp, uniqueEmail } from './helpers';
import { TEST_DB, TEST_MIGRATE_DB } from './env';

const SETUP_CODE = 'test-setup-code-1234';
const OWNER_PW = 'owner password 123';
const PW = 'correct horse 1';
const WRONG = { message: 'Email or password is wrong.' };

let app: INestApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
beforeAll(async () => {
  process.env.OWNER_SETUP_CODE = SETUP_CODE;
  // the panel's setup works only while no owner account exists (another file in this run may not have made one)
  const ownerRole = new PrismaClient({ datasourceUrl: TEST_MIGRATE_DB });
  await ownerRole.ownerSession.deleteMany();
  await ownerRole.superAdmin.deleteMany();
  await ownerRole.$disconnect();
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
});
afterAll(async () => {
  delete process.env.OWNER_SETUP_CODE;
  await db.$disconnect();
  await app.close();
});

const setup = (body: Record<string, string>) => http().post('/api/owner/setup').send({ code: SETUP_CODE, name: 'Aman Kumar', password: OWNER_PW, password2: OWNER_PW, ...body });
const login = (email: string, password: string) => http().post('/api/auth/login').send({ email, password });
const audit = async (adminId: string) => db.ownerAuditLog.findMany({ where: { adminId }, orderBy: { createdAt: 'asc' } });
const cookies = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];

/** an owner account made straight in the database (setup works only once per database) */
async function makeAdmin(): Promise<{ id: string; email: string }> {
  const { hashPassword } = await import('../src/modules/auth/password');
  const a = await db.superAdmin.create({ data: { email: uniqueEmail('owner'), name: 'Panel Owner', passwordHash: await hashPassword(OWNER_PW) } });
  return { id: a.id, email: a.email };
}
async function panel(): Promise<{ id: string; email: string; token: string; cookie: string }> {
  const a = await makeAdmin();
  const r = await login(a.email, OWNER_PW).expect(200);
  return { ...a, token: r.body.accessToken, cookie: cookieOf(r) };
}

describe('owner panel setup', () => {
  it('needs the code, a new email and a 12-character password; then closes for good', async () => {
    expect((await http().get('/api/owner/setup').expect(200)).body).toEqual({ open: true });
    expect((await setup({ email: uniqueEmail('o'), code: 'wrong-code-0000' }).expect(401)).body.message).toBe('The setup code is wrong.');
    expect((await setup({ email: uniqueEmail('o'), password: 'short pw 1', password2: 'short pw 1' }).expect(400)).body.message).toBe('Use at least 12 characters for the password.');
    expect((await setup({ email: uniqueEmail('o'), password2: 'something else 1' }).expect(400)).body.message).toBe('The two passwords don’t match.');
    const shop = await signUp(app);
    expect((await setup({ email: shop.email }).expect(409)).body.message).toBe('This email has a shop account. Use another email for the owner panel.');
    expect(await db.superAdmin.count()).toBe(0);

    const email = uniqueEmail('owner');
    await setup({ email }).expect(204);
    const a = await db.superAdmin.findUniqueOrThrow({ where: { email } });
    expect(a.name).toBe('Aman Kumar');
    expect(a.passwordHash).not.toContain(OWNER_PW);
    expect((await audit(a.id)).map((e) => e.action)).toEqual(['setup']);

    expect((await http().get('/api/owner/setup').expect(200)).body).toEqual({ open: false });
    expect((await setup({ email: uniqueEmail('o') }).expect(404)).body.message).toBe('The setup page is closed.');
    expect(await db.superAdmin.count()).toBe(1);
  });
});

describe('owner sign-in on the shared page', () => {
  it('gets a panel sign-in and its own cookie; the shop cookie is cleared', async () => {
    const a = await makeAdmin();
    const r = await login(a.email, OWNER_PW).expect(200);
    expect(r.body).toMatchObject({ owner: true, expiresIn: expect.any(Number) });
    const set = cookies(r);
    expect(set.find((c) => c.startsWith('erp_ort='))).toMatch(/Path=\/api\/owner\/auth; .*HttpOnly/);
    expect(set.find((c) => c.startsWith('erp_rt='))).toMatch(/^erp_rt=;/);
    const me = await http().get('/api/owner/me').set(auth({ token: r.body.accessToken })).expect(200);
    expect(me.body).toEqual({ name: 'Panel Owner', email: a.email });
    expect((await audit(a.id)).map((e) => e.action)).toEqual(['sign_in']);
    expect((await db.superAdmin.findUniqueOrThrow({ where: { id: a.id } })).lastLoginAt).not.toBeNull();

    // a shop sign-in on the same browser clears the panel's cookie
    const shop = await signUp(app);
    const s = await login(shop.email, PW).expect(200);
    expect(cookies(s).find((c) => c.startsWith('erp_ort='))).toMatch(/^erp_ort=;/);
    expect(s.body.owner).toBeUndefined();
  });

  it('a wrong password for the owner looks exactly like any wrong sign-in', async () => {
    const a = await makeAdmin();
    const shop = await signUp(app);
    const owner = await login(a.email, 'not the password').expect(401);
    const unknown = await login(uniqueEmail('nobody'), 'not the password').expect(401);
    const shopWrong = await login(shop.email, 'not the password').expect(401);
    expect(owner.body).toEqual(WRONG);
    expect(unknown.body).toEqual(WRONG);
    expect(shopWrong.body).toEqual(WRONG);
    expect(cookies(owner).some((c) => c.startsWith('erp_ort='))).toBe(false);
  });

  it('5 wrong passwords lock for 15 minutes, 10 for an hour; the right password is refused meanwhile', async () => {
    const a = await makeAdmin();
    for (let i = 0; i < 4; i++) await login(a.email, 'wrong ' + i).expect(401);
    expect((await db.superAdmin.findUniqueOrThrow({ where: { id: a.id } })).lockedUntil).toBeNull();
    await login(a.email, 'wrong 4').expect(401);
    let row = await db.superAdmin.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.failedTries).toBe(5);
    const mins = (row.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThanOrEqual(15);
    expect((await login(a.email, OWNER_PW).expect(401)).body).toEqual(WRONG);

    // the 15 minutes pass; the next five wrong ones lock for an hour
    await db.superAdmin.update({ where: { id: a.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    for (let i = 5; i < 10; i++) await login(a.email, 'wrong ' + i).expect(401);
    row = await db.superAdmin.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.failedTries).toBe(10);
    expect((row.lockedUntil!.getTime() - Date.now()) / 60_000).toBeGreaterThan(59);

    const log = await audit(a.id);
    expect(log.filter((e) => e.action === 'locked').map((e) => (e.after as { minutes: number }).minutes)).toEqual([15, 60]);
    expect(log.filter((e) => e.action === 'sign_in_failed')).toHaveLength(11);

    // after the hour the right password opens the panel and the count starts again
    await db.superAdmin.update({ where: { id: a.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await login(a.email, OWNER_PW).expect(200);
    row = await db.superAdmin.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ failedTries: 0, lockedUntil: null });
  });

  it('the owner email can’t become a shop account (same answer as any taken email)', async () => {
    const a = await makeAdmin();
    const r = await http().post('/api/auth/register').send({ email: a.email, password: PW, name: '' }).expect(409);
    const shop = await signUp(app);
    const r2 = await http().post('/api/auth/register').send({ email: shop.email, password: PW, name: '' }).expect(409);
    expect(r.body).toEqual(r2.body);
  });
});

describe('panel tokens and shop tokens never mix', () => {
  it('shop routes refuse panel tokens; panel routes refuse shop tokens and look-alike tokens', async () => {
    const p = await panel();
    const o = await owner(app);
    await http().get('/api/me').set(auth(p)).expect(401);
    await http().get('/api/parties').set(auth(p)).expect(401);
    for (const path of ['/api/owner/me', '/api/owner/customers']) {
      await http().get(path).set(auth(o)).expect(401);
      await http().get(path).expect(401);
    }
    await http().post(`/api/owner/customers/${o.businessId}/suspend`).set(auth(o)).expect(401);
    expect((await db.business.count({ where: { status: 'suspended' } }))).toBe(0);

    // a token with the panel's fields but signed with the shop key is refused
    const forged = await new JwtService({ secret: process.env.JWT_SECRET }).signAsync({ sub: p.id, email: p.email, sid: '00000000-0000-0000-0000-000000000000', typ: 'owner' });
    await http().get('/api/owner/customers').set(auth({ token: forged })).expect(401);
    await http().get('/api/owner/customers').set(auth(p)).expect(200);
  });

  it('refresh renews within the same 12 hours; sign-out ends the sign-in and its access token', async () => {
    const p = await panel();
    const s1 = await db.ownerSession.findFirstOrThrow({ where: { adminId: p.id } });
    expect((s1.expiresAt.getTime() - Date.now()) / 3_600_000).toBeGreaterThan(11.9);
    const r = await http().post('/api/owner/auth/refresh').set('Cookie', p.cookie).expect(200);
    const s2 = await db.ownerSession.findFirstOrThrow({ where: { adminId: p.id, revokedAt: null } });
    expect(s2.id).not.toBe(s1.id);
    expect(s2.expiresAt.getTime()).toBe(s1.expiresAt.getTime());
    // the old refresh cookie used again: every panel sign-in ends (it was copied)
    await http().post('/api/owner/auth/refresh').set('Cookie', p.cookie).expect(401);
    await http().get('/api/owner/me').set(auth({ token: r.body.accessToken })).expect(401);

    const q = await panel();
    await http().get('/api/owner/me').set(auth(q)).expect(200);
    await http().post('/api/owner/auth/logout').set('Cookie', q.cookie).expect(204);
    await http().get('/api/owner/me').set(auth(q)).expect(401);
    await http().post('/api/owner/auth/refresh').set('Cookie', q.cookie).expect(401);
    expect((await audit(q.id)).map((e) => e.action)).toEqual(['sign_in', 'sign_out']);

    // a shop's refresh cookie does nothing for the panel
    const o = await owner(app);
    await http().post('/api/owner/auth/refresh').set('Cookie', o.cookie).expect(401);
  });
});

describe('customers', () => {
  it('lists name, contact, type, plan and status only', async () => {
    const p = await panel();
    const o = await owner(app, { name: 'Verma Cloth House', owner: 'Sunita Verma', state: '09', city: 'Lucknow', phone: '+91 98123 09876' } as never);
    const r = await http().get('/api/owner/customers').set(auth(p)).expect(200);
    expect(r.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const c = r.body.customers.find((x: { id: string }) => x.id === o.businessId);
    expect(Object.keys(c).sort()).toEqual(['businessType', 'code', 'email', 'enrolled', 'id', 'mobile', 'name', 'ownerName', 'paidUntil', 'plan', 'status', 'trialEndsOn', 'via'].sort());
    expect(c).toMatchObject({ name: 'Verma Cloth House', ownerName: 'Sunita Verma', mobile: '9812309876', email: o.email, businessType: 'General', via: 'email', plan: 'trial', paidUntil: null, status: 'active' });
    expect(c.code).toMatch(/^BE-\d+$/);
  });

  it('the panel’s database setting reads shops but never a shop’s own data', async () => {
    const o = await owner(app);
    const a = await makeAdmin();
    const seen = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.owner_admin_id', ${a.id}, true)`;
      return {
        shop: await tx.business.count({ where: { id: o.businessId } }),
        members: await tx.membership.count({ where: { businessId: o.businessId } }),
        settings: await tx.businessSettings.count({ where: { businessId: o.businessId } }),
        series: await tx.documentSeries.count({ where: { businessId: o.businessId } }),
        audit: await tx.auditLog.count({ where: { businessId: o.businessId } }),
        changes: await tx.changeLog.count({ where: { businessId: o.businessId } }),
      };
    });
    expect(seen).toEqual({ shop: 1, members: 1, settings: 0, series: 0, audit: 0, changes: 0 });
    // the same rows exist for the shop itself
    const own = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.business_id', ${o.businessId}, true)`;
      return { settings: await tx.businessSettings.count(), series: await tx.documentSeries.count(), audit: await tx.auditLog.count() };
    });
    expect(own.settings).toBe(1);
    expect(own.series).toBeGreaterThan(0);
    expect(own.audit).toBeGreaterThan(0);
  });

  it('Suspend: the shop can’t sign in or use the app; Reactivate: back to normal; nothing deleted; audited', async () => {
    const p = await panel();
    const o = await owner(app);
    const staff = await member(app, o, 'billing_staff');
    const before = await http().get('/api/parties').set(auth(o)).expect(200);

    const s = await http().post(`/api/owner/customers/${o.businessId}/suspend`).set(auth(p)).expect(200);
    expect(s.body).toMatchObject({ id: o.businessId, status: 'suspended' });
    const paused = { message: 'This shop’s account is paused. Please contact support.', code: 'suspended' };
    expect((await http().get('/api/me').set(auth(o)).expect(403)).body).toMatchObject(paused);
    expect((await http().get('/api/parties').set(auth(staff)).expect(403)).body).toMatchObject(paused);
    expect((await login(o.email, PW).expect(403)).body).toMatchObject(paused);
    expect((await login(staff.email, PW).expect(403)).body).toMatchObject(paused);
    // suspending again changes nothing and logs nothing
    await http().post(`/api/owner/customers/${o.businessId}/suspend`).set(auth(p)).expect(200);

    await http().post(`/api/owner/customers/${o.businessId}/reactivate`).set(auth(p)).expect(200);
    const back = await login(o.email, PW).expect(200);
    const after = await http().get('/api/parties').set(auth({ token: back.body.accessToken })).expect(200);
    expect(after.body).toEqual(before.body);
    await http().get('/api/me').set(auth(staff)).expect(200);

    const log = (await audit(p.id)).filter((e) => e.businessId === o.businessId);
    expect(log.map((e) => [e.action, e.before, e.after])).toEqual([
      ['suspend', { status: 'active' }, { status: 'suspended' }],
      ['reactivate', { status: 'suspended' }, { status: 'active' }],
    ]);
    // the status change is in the shop's real-time backup list too
    const changes = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.business_id', ${o.businessId}, true)`;
      return tx.changeLog.findMany({ where: { tbl: 'businesses' }, orderBy: { id: 'asc' } });
    });
    expect(changes.map((c) => (c.data as { status: string }).status).slice(-2)).toEqual(['suspended', 'active']);
  });

  it('a person with another active shop lands there; switching into the suspended one is refused', async () => {
    const p = await panel();
    const o = await owner(app);
    const second = await http().post('/api/businesses').set(auth(o)).send({ name: 'Second Shop', owner: 'Ravi Gupta', state: '09' }).expect(201);
    const secondId = second.body.business.id as string;
    await http().post(`/api/owner/customers/${secondId}/suspend`).set(auth(p)).expect(200);
    const r = await login(o.email, PW).expect(200);
    const me = await http().get('/api/me').set(auth({ token: r.body.accessToken })).expect(200);
    expect(me.body.business.id).toBe(o.businessId);
    const sw = await http().post('/api/businesses/switch').set(auth({ token: r.body.accessToken })).send({ businessId: secondId }).expect(403);
    expect(sw.body.code).toBe('suspended');
  });

  it('an unknown customer is a clear error', async () => {
    const p = await panel();
    await http().post('/api/owner/customers/00000000-0000-4000-8000-000000000000/suspend').set(auth(p)).expect(404);
    await http().post('/api/owner/customers/not-a-uuid/suspend').set(auth(p)).expect(400);
  });
});
