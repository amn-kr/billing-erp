/**
 * Settings › General › Team › Reset password (owner's request, 25 Oct 2026), "Choose a new password",
 * and the support reset script (run here only against the local test database).
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, signUp, SHOP, startApp } from './helpers';
import { TEST_DB } from './env';

let app: INestApplication;
let db: PrismaClient;
const http = () => request(app.getHttpServer());
beforeAll(async () => {
  app = await startApp();
  db = new PrismaClient({ datasourceUrl: TEST_DB });
});
afterAll(async () => {
  await db.$disconnect();
  await app.close();
});

const STAFF_PW = 'correct horse 1';
const TEMP = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
type S = { token: string; cookie?: string; email: string };
const login = (email: string, password: string) => http().post('/api/auth/login').send({ email, password });
const reset = (o: S, membershipId: string) => http().post(`/api/members/${membershipId}/reset-password`).set(auth(o));
const audit = async (o: S) => (await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as { action: string; entityId: string | null; after: Record<string, unknown> | null; userId: string | null }[];
const team = async (o: S) => (await http().get('/api/members').set(auth(o)).expect(200)).body as { members: { id: string; email: string; inOtherShops: boolean }[] };

describe('owner resets a staff password', () => {
  it('gives a temporary password once; it opens only "Choose a new password"; the new one then works', async () => {
    const o = await owner(app);
    const s = await member(app, o, 'manager');
    expect((await team(o)).members.find((m) => m.email === s.email)?.inOtherShops).toBe(false);

    const r = await reset(o, s.membershipId).expect(200);
    const temp = r.body.temporaryPassword as string;
    expect(temp).toMatch(TEMP);
    const hours = (Date.parse(r.body.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);

    // the old password stops working; the staff member's other sign-ins have ended
    await login(s.email, STAFF_PW).expect(401);
    await http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);

    const t = await login(s.email, temp).expect(200);
    const st = { token: t.body.accessToken as string, email: s.email };
    const me = await http().get('/api/me').set(auth(st)).expect(200);
    expect(me.body.user.mustChangePassword).toBe(true);
    // everything else is refused until a new password is chosen, checked on the server
    const blocked = await http().get('/api/items').set(auth(st)).expect(403);
    expect(blocked.body.code).toBe('change_password');
    await http().get('/api/members').set(auth(st)).expect(403);

    await http().post('/api/auth/change-password').set(auth(st)).send({ current: 'wrong', password: 'my own password 1' }).expect(400);
    await http().post('/api/auth/change-password').set(auth(st)).send({ current: temp, password: 'short' }).expect(400);
    await http().post('/api/auth/change-password').set(auth(st)).send({ current: temp, password: temp }).expect(400);
    await http().post('/api/auth/change-password').set(auth(st)).send({ current: temp, password: 'my own password 1' }).expect(204);

    await http().get('/api/items').set(auth(st)).expect(200);
    expect((await http().get('/api/me').set(auth(st)).expect(200)).body.user.mustChangePassword).toBe(false);
    await login(s.email, temp).expect(401);
    await login(s.email, 'my own password 1').expect(200);

    // written in the activity log, never the password itself
    const log = await audit(o);
    expect(log.some((e) => e.action === 'reset_password' && e.entityId === s.membershipId && e.after?.by === 'owner')).toBe(true);
    expect(log.some((e) => e.action === 'password_changed')).toBe(true);
    expect(JSON.stringify(log)).not.toContain(temp);
  });

  it('a second reset replaces the first temporary password', async () => {
    const o = await owner(app);
    const s = await member(app, o, 'billing_staff');
    const first = (await reset(o, s.membershipId).expect(200)).body.temporaryPassword as string;
    const second = (await reset(o, s.membershipId).expect(200)).body.temporaryPassword as string;
    expect(second).not.toBe(first);
    await login(s.email, first).expect(401);
    await login(s.email, second).expect(200);
  });

  it('the temporary password stops working after 48 hours', async () => {
    const o = await owner(app);
    const s = await member(app, o, 'manager');
    const temp = (await reset(o, s.membershipId).expect(200)).body.temporaryPassword as string;
    await db.user.update({ where: { email: s.email }, data: { tempPasswordExpiresAt: new Date(Date.now() - 1000) } });
    const r = await login(s.email, temp).expect(401);
    expect(r.body.message).toMatch(/expired/i);
  });

  it('refused for an account that is also used in another shop (their own, or as staff elsewhere)', async () => {
    const o = await owner(app);
    // staff who also owns a shop
    const s = await signUp(app);
    const own = await http().post('/api/businesses').set(auth(s)).send({ ...SHOP, name: 'Singh Traders' }).expect(201);
    const inv = await http().post('/api/members/invites').set(auth(o)).send({ email: s.email, role: 'manager' }).expect(201);
    await http().post(`/api/invites/${inv.body.id}/accept`).set('Authorization', `Bearer ${own.body.accessToken}`).send({ name: 'Pooja' }).expect(200);
    const m = (await team(o)).members.find((x) => x.email === s.email)!;
    expect(m.inOtherShops).toBe(true);
    const r = await reset(o, m.id).expect(403);
    expect(r.body.message).toMatch(/another shop/);
    await login(s.email, STAFF_PW).expect(200);

    // staff in two shops: neither owner can reset
    const o2 = await owner(app);
    const both = await member(app, o, 'manager');
    const inv2 = await http().post('/api/members/invites').set(auth(o2)).send({ email: both.email, role: 'manager' }).expect(201);
    await http().post(`/api/invites/${inv2.body.id}/accept`).set(auth(both)).send({ name: 'Both' }).expect(200);
    await reset(o, both.membershipId).expect(403);
    const m2 = (await team(o2)).members.find((x) => x.email === both.email)!;
    await reset(o2, m2.id).expect(403);
  });

  it('removed from the other shop: then the owner can reset again', async () => {
    const o = await owner(app);
    const o2 = await owner(app);
    const s = await member(app, o, 'manager');
    const inv = await http().post('/api/members/invites').set(auth(o2)).send({ email: s.email, role: 'manager' }).expect(201);
    await http().post(`/api/invites/${inv.body.id}/accept`).set(auth(s)).send({ name: 'S' }).expect(200);
    await reset(o, s.membershipId).expect(403);
    const m2 = (await team(o2)).members.find((x) => x.email === s.email)!;
    await http().post(`/api/members/${m2.id}/remove`).set(auth(o2)).expect(204);
    await reset(o, s.membershipId).expect(200);
  });

  it('only the shop owner, only people in their own shop, never an owner', async () => {
    const o = await owner(app);
    const manager = await member(app, o, 'manager');
    const accountant = await member(app, o, 'accountant');
    const s = await member(app, o, 'billing_staff');
    // a manager can manage the team but not reset passwords; an accountant can't manage the team at all
    expect((await reset(manager, s.membershipId).expect(403)).body.message).toBe('Only the shop owner can reset a password.');
    await reset(accountant, s.membershipId).expect(403);
    // the owner's own row
    const ownRow = (await team(o)).members.find((x) => x.email === o.email)!;
    await reset(o, ownRow.id).expect(403);
    // someone in another shop is not found from this one
    const other = await owner(app);
    const theirs = await member(app, other, 'manager');
    await reset(o, theirs.membershipId).expect(404);
    await login(theirs.email, STAFF_PW).expect(200);
    // a removed member is not found either
    await http().post(`/api/members/${s.membershipId}/remove`).set(auth(o)).expect(204);
    await reset(o, s.membershipId).expect(404);
    await reset(o, '00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('nobody else is asked to choose a new password', async () => {
    const o = await owner(app);
    expect((await http().get('/api/me').set(auth(o)).expect(200)).body.user.mustChangePassword).toBe(false);
    await http().get('/api/items').set(auth(o)).expect(200);
  });
});

describe('support reset script (local test database only)', () => {
  const run = promisify(execFile);
  const API_DIR = path.resolve(__dirname, '..');
  const script = (args: string[], url = TEST_DB) =>
    run(process.execPath, ['-r', '@swc-node/register', 'scripts/support-reset.ts', ...args], { cwd: API_DIR, env: { ...process.env, DATABASE_URL: url } }).then(
      (r) => ({ code: 0, out: r.stdout, err: r.stderr }),
      (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout, err: e.stderr }),
    );

  it('shows information only by default; changes nothing', async () => {
    const o = await owner(app);
    const r = await script(['--email', o.email]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Gupta Electricals & Hardware');
    expect(r.out).toContain('Information only — nothing was changed');
    await login(o.email, STAFF_PW).expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { email: o.email } })).mustChangePassword).toBe(false);
  }, 60_000);

  it('refuses --confirm without a ticket, an unknown email, and a database not on this computer', async () => {
    const o = await owner(app);
    expect((await script(['--email', o.email, '--confirm'])).err).toMatch(/needs --ticket/);
    expect((await script(['--email', 'nobody@test.example.com'])).err).toMatch(/No account/);
    const live = await script(['--email', o.email, '--ticket', 'T-1', '--confirm'], 'postgresql://erp_app:x@ep-example.neon.tech/neondb');
    expect(live.code).not.toBe(0);
    expect(live.err).toMatch(/Refused: .*not on this computer/);
    await login(o.email, STAFF_PW).expect(200);
  }, 60_000);

  it('with a ticket and --confirm: a temporary password, sign-ins ended, written in the shop’s activity log', async () => {
    const o = await owner(app);
    const r = await script(['--email', o.email, '--ticket', 'T-42', '--confirm']);
    expect(r.code).toBe(0);
    const temp = r.out.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/)?.[0];
    expect(temp).toBeTruthy();
    await http().post('/api/auth/refresh').set('Cookie', o.cookie).expect(401);
    await login(o.email, STAFF_PW).expect(401);
    const t = await login(o.email, temp!).expect(200);
    const st = { token: t.body.accessToken as string, email: o.email };
    await http().get('/api/items').set(auth(st)).expect(403);
    await http().post('/api/auth/change-password').set(auth(st)).send({ current: temp, password: 'owner new password 1' }).expect(204);
    const log = await audit(st);
    expect(log.some((e) => e.action === 'reset_password' && e.after?.by === 'support' && e.after?.ticket === 'T-42' && e.userId === null)).toBe(true);
    expect(JSON.stringify(log)).not.toContain(temp);
  }, 60_000);
});
