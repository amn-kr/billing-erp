/**
 * Recovery codes (owner's request, 1 Nov 2026): Settings › General › Recovery codes makes ten one-time codes
 * after the person's password; "Forgot password?" on the sign-in page takes the email, one code and a new
 * password.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, signUp, startApp } from './helpers';
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

const PW = 'correct horse 1';
const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
type S = { token: string; cookie?: string; email: string };
/** ten codes, as the server returns them */
type Ten = [string, string, string, string, string, string, string, string, string, string];
const login = (email: string, password: string) => http().post('/api/auth/login').send({ email, password });
const make = (s: S, password = PW) => http().post('/api/auth/recovery-codes').set(auth(s)).send({ password });
const state = async (s: S) => (await http().get('/api/auth/recovery-codes').set(auth(s)).expect(200)).body as { left: number; total: number; madeAt: string | null };
const recover = (email: string, code: string, password: string) => http().post('/api/auth/recover').send({ email, code, password });
const audit = async (o: S) => (await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as { action: string; entityId: string | null; after: Record<string, unknown> | null }[];

describe('recovery codes', () => {
  it('ten codes after the password, shown once; only hashes are stored', async () => {
    const o = await owner(app);
    expect(await state(o)).toEqual({ left: 0, total: 0, madeAt: null });
    await make(o, 'wrong password').expect(400);
    expect((await state(o)).total).toBe(0);

    const r = await make(o).expect(200);
    const codes = r.body.codes as Ten;
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(CODE);
    expect(new Set(codes).size).toBe(10);
    expect(await state(o)).toMatchObject({ left: 10, total: 10, madeAt: r.body.madeAt });

    const user = await db.user.findUniqueOrThrow({ where: { email: o.email } });
    const rows = await db.recoveryCode.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(10);
    for (const c of codes) expect(JSON.stringify(rows)).not.toContain(c.replace('-', ''));

    const log = await audit(o);
    expect(log.some((e) => e.action === 'recovery_codes_made')).toBe(true);
    expect(JSON.stringify(log)).not.toContain(codes[0]);
  });

  it('a code, the email and a new password sign the person in; the code works once; other sign-ins end', async () => {
    const o = await owner(app);
    const codes = (await make(o).expect(200)).body.codes as Ten;

    const r = await recover(o.email, codes[3], 'my new password 1').expect(200);
    expect(r.body.accessToken).toEqual(expect.any(String));
    expect(r.headers['set-cookie']?.toString()).toContain('erp_rt=');
    const s = { token: r.body.accessToken as string, email: o.email };
    expect((await http().get('/api/me').set(auth(s)).expect(200)).body.business.id).toBe(o.businessId);

    await login(o.email, PW).expect(401);
    await login(o.email, 'my new password 1').expect(200);
    // other devices can't renew their sign-in (it ends within the 15-minute access time, as everywhere)
    await http().post('/api/auth/refresh').set('Cookie', o.cookie!).expect(401);

    // the same code again is refused; typed in small letters without the dash, another works
    await recover(o.email, codes[3], 'another password 1').expect(400);
    await recover(o.email, codes[4].toLowerCase().replace('-', ' '), 'another password 1').expect(200);
    expect(await state(s)).toMatchObject({ left: 8, total: 10 });

    const log = await audit(s);
    expect(log.filter((e) => e.action === 'password_recovered').map((e) => e.after?.codesLeft)).toEqual(expect.arrayContaining([9, 8]));
  });

  it('"Make new codes" stops the unused old ones', async () => {
    const o = await owner(app);
    const first = (await make(o).expect(200)).body.codes as Ten;
    await recover(o.email, first[0], 'my new password 1').expect(200);
    const s = { token: (await login(o.email, 'my new password 1').expect(200)).body.accessToken as string, email: o.email };
    const second = (await make(s, 'my new password 1').expect(200)).body.codes as Ten;
    expect(await state(s)).toMatchObject({ left: 10, total: 10 });
    await recover(o.email, first[1], 'another password 1').expect(400);
    await recover(o.email, second[0], 'another password 1').expect(200);
  });

  it('a wrong email and a wrong code get the same answer; five wrong codes make the account wait', async () => {
    const o = await owner(app);
    const codes = (await make(o).expect(200)).body.codes as Ten;
    const noOne = await recover('no.one@test.example.com', codes[0], 'my new password 1').expect(400);
    const wrong = await recover(o.email, 'AAAA-AAAA', 'my new password 1').expect(400);
    expect(noOne.body.message).toBe(wrong.body.message);

    for (let i = 0; i < 4; i++) await recover(o.email, 'AAAA-AAAA', 'my new password 1').expect(400);
    const wait = await recover(o.email, codes[0], 'my new password 1').expect(400);
    expect(wait.body.message).toMatch(/Too many wrong codes\. Try again in 15 minutes\./);
    await login(o.email, PW).expect(200);

    // after the wait, the right code works again and the count starts over
    await db.user.update({ where: { email: o.email }, data: { recoveryWaitUntil: new Date(Date.now() - 1000) } });
    await recover(o.email, codes[0], 'my new password 1').expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { email: o.email } })).recoveryFails).toBe(0);
  });

  it('checks the new password; staff make their own; a temporary password must be changed first', async () => {
    const o = await owner(app);
    const codes = (await make(o).expect(200)).body.codes as Ten;
    await recover(o.email, codes[0], 'short').expect(400);
    expect(await state(o)).toMatchObject({ left: 10 });

    const st = await member(app, o, 'manager');
    expect((await make(st).expect(200)).body.codes).toHaveLength(10);
    expect(await state(o)).toMatchObject({ left: 10 });

    const tempOut = await http().post(`/api/members/${st.membershipId}/reset-password`).set(auth(o)).expect(200);
    const t = { token: (await login(st.email, tempOut.body.temporaryPassword).expect(200)).body.accessToken as string, email: st.email };
    await http().get('/api/auth/recovery-codes').set(auth(t)).expect(403);
  });

  it('someone without a shop can make codes too; nobody else can see or use them', async () => {
    const u = await signUp(app);
    const codes = (await make(u).expect(200)).body.codes as Ten;
    const other = await owner(app);
    await recover(other.email, codes[0], 'my new password 1').expect(400);
    expect(await state(other)).toMatchObject({ total: 0 });
    await recover(u.email, codes[0], 'my new password 1').expect(200);
  });
});
