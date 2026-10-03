import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, cookieOf, signUp, startApp, uniqueEmail } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

describe('POST /api/auth/register', () => {
  it('creates an account, returns an access token and sets an httpOnly refresh cookie', async () => {
    const res = await http().post('/api/auth/register').send({ email: uniqueEmail(), password: 'long enough 1' }).expect(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.expiresIn).toBe(900);
    const c = String(res.headers['set-cookie']);
    expect(c).toMatch(/erp_rt=/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Path=\/api\/auth/);
  });
  it('refuses a duplicate email in plain words', async () => {
    const email = uniqueEmail();
    await http().post('/api/auth/register').send({ email, password: 'long enough 1' }).expect(201);
    const res = await http().post('/api/auth/register').send({ email: email.toUpperCase(), password: 'long enough 1' }).expect(409);
    expect(res.body.message).toBe('An account with this email already exists. Sign in instead.');
  });
  it('validates input', async () => {
    const res = await http().post('/api/auth/register').send({ email: 'nope', password: 'x' }).expect(400);
    expect(res.body.message).toBe('That email doesn’t look right.');
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password', async () => {
    const s = await signUp(app, uniqueEmail(), 'my password 1');
    const res = await http().post('/api/auth/login').send({ email: s.email, password: 'my password 1' }).expect(200);
    expect(res.body.accessToken).toBeTruthy();
  });
  it('gives the same answer for wrong password and unknown email', async () => {
    const s = await signUp(app, uniqueEmail(), 'my password 1');
    const a = await http().post('/api/auth/login').send({ email: s.email, password: 'wrong' }).expect(401);
    const b = await http().post('/api/auth/login').send({ email: uniqueEmail(), password: 'wrong' }).expect(401);
    expect(a.body.message).toBe('Email or password is wrong.');
    expect(b.body.message).toBe(a.body.message);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token; re-using an old one signs the person out everywhere', async () => {
    const s = await signUp(app);
    const r1 = await http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(200);
    const c1 = cookieOf(r1);
    expect(c1).not.toBe(s.cookie);
    // old cookie again = stolen token
    await http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
    // ...so the new one is revoked too
    await http().post('/api/auth/refresh').set('Cookie', c1).expect(401);
  });
  it('needs a cookie', async () => {
    await http().post('/api/auth/refresh').expect(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token', async () => {
    const s = await signUp(app);
    await http().post('/api/auth/logout').set('Cookie', s.cookie).expect(204);
    await http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
  });
});

describe('forgot / reset password', () => {
  it('answers the same for any email', async () => {
    await http().post('/api/auth/forgot').send({ email: uniqueEmail() }).expect(204);
  });
  it('rejects an unknown reset token', async () => {
    const res = await http().post('/api/auth/reset').send({ token: 'x'.repeat(20), password: 'new password 1' }).expect(401);
    expect(res.body.message).toMatch(/expired/);
  });
});

describe('GET /api/me', () => {
  it('needs sign-in', async () => {
    const res = await http().get('/api/me').expect(401);
    expect(res.body.message).toBe('Please sign in.');
  });
  it('rejects a forged token', async () => {
    await http().get('/api/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
  });
  it('shows a new person with no shop yet', async () => {
    const s = await signUp(app);
    const res = await http().get('/api/me').set(auth(s)).expect(200);
    expect(res.body.user.email).toBe(s.email);
    expect(res.body.business).toBeNull();
    expect(res.body.memberships).toEqual([]);
  });
});

describe('GET /api/health', () => {
  it('is public', async () => {
    await http().get('/api/health').expect(200, { ok: true });
  });
});
