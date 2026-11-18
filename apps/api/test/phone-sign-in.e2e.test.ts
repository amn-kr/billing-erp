import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHOP, startApp, uniqueEmail } from './helpers';

/**
 * Phone sign-in (step 8.1c, owner 18 Nov 2026): the phone keeps its "stay signed in" token in
 * Android's safe store and sends it in a header; the web keeps its cookie, unchanged.
 */
let app: INestApplication;
const http = () => request(app.getHttpServer());
const PHONE = { 'x-app-client': 'phone' };
const PASSWORD = 'correct horse 1';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

async function phoneShop() {
  const email = uniqueEmail('phone');
  const reg = await http().post('/api/auth/register').set(PHONE).send({ email, password: PASSWORD, name: '' }).expect(201);
  const shop = await http().post('/api/businesses').set(PHONE).set('Authorization', `Bearer ${reg.body.accessToken}`).send(SHOP).expect(201);
  return { email, reg, shop };
}
const refresh = (rt: string) => http().post('/api/auth/refresh').set(PHONE).set('x-refresh-token', rt);

describe('phone sign-in', () => {
  it('gives the phone its token in the answer, never as a cookie', async () => {
    const { reg, shop } = await phoneShop();
    for (const r of [reg, shop]) {
      expect(String(r.headers['set-cookie'] ?? '')).not.toContain('erp_rt=');
      expect(r.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), refreshExpires: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    }
    expect(shop.body.business).toMatchObject({ name: SHOP.name });
  });

  it('stays signed in with the header: each renewal gives a new token, an old one signs the phone out', async () => {
    const { email, shop } = await phoneShop();
    const a = await refresh(shop.body.refreshToken).expect(200);
    expect(a.body.refreshToken).not.toBe(shop.body.refreshToken);
    expect(String(a.headers['set-cookie'] ?? '')).not.toContain('erp_rt=');
    // the new access token works, for the same shop
    const me = await http().get('/api/me').set(PHONE).set('Authorization', `Bearer ${a.body.accessToken}`).expect(200);
    expect(me.body.user.email).toBe(email);
    // a used token again looks stolen: refused, and the newer one stops working too
    await refresh(shop.body.refreshToken).expect(401);
    await refresh(a.body.refreshToken).expect(401);
  });

  it('signs in with email and password, and signs out', async () => {
    const { email } = await phoneShop();
    const r = await http().post('/api/auth/login').set(PHONE).send({ email, password: PASSWORD }).expect(200);
    expect(String(r.headers['set-cookie'] ?? '')).not.toContain('erp_rt=');
    expect(r.body.refreshToken).toEqual(expect.any(String));
    await http().post('/api/auth/logout').set(PHONE).set('x-refresh-token', r.body.refreshToken).expect(204);
    await refresh(r.body.refreshToken).expect(401);
  });

  it('without a token, or with a wrong one, the phone is asked to sign in', async () => {
    expect((await http().post('/api/auth/refresh').set(PHONE).expect(401)).body.message).toBe('Please sign in.');
    await refresh('not-a-real-token').expect(401);
  });

  it('a web page can’t pretend to be the phone; the web keeps its cookie and never sees the token', async () => {
    const email = uniqueEmail('web');
    const fromPage = await http().post('/api/auth/register').set(PHONE).set('Origin', 'http://localhost:5173').send({ email, password: PASSWORD, name: '' }).expect(201);
    expect(fromPage.body.refreshToken).toBeUndefined();
    expect(String(fromPage.headers['set-cookie'])).toContain('erp_rt=');
    const fetched = await http().post('/api/auth/login').set(PHONE).set('Sec-Fetch-Site', 'same-origin').send({ email, password: PASSWORD }).expect(200);
    expect(fetched.body.refreshToken).toBeUndefined();
    const web = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    expect(web.body.refreshToken).toBeUndefined();
    expect(String(web.headers['set-cookie'])).toContain('erp_rt=');
  });
});
