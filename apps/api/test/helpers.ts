import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import { applyTestEnv } from './env';

applyTestEnv();

export async function startApp(): Promise<INestApplication> {
  const { resetConfig } = await import('../src/config');
  resetConfig();
  const { createApp } = await import('../src/app.factory');
  const app = await createApp();
  await app.init();
  return app;
}

let n = 0;
export const uniqueEmail = (tag = 'u') => `${tag}.${Date.now().toString(36)}.${++n}@test.example.com`;

export const SHOP = { name: 'Gupta Electricals & Hardware', owner: 'Ravi Gupta', state: '09', city: 'Lucknow', gstin: '09ABCPS4821K1Z6' };

export interface Session {
  token: string;
  cookie: string;
  email: string;
}

const cookieOf = (res: request.Response) => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => c.split(';')[0]).join('; ');
};

export async function signUp(app: INestApplication, email = uniqueEmail(), password = 'correct horse 1'): Promise<Session> {
  const res = await request(app.getHttpServer()).post('/api/auth/register').send({ email, password, name: '' }).expect(201);
  return { token: res.body.accessToken, cookie: cookieOf(res), email };
}

/** A person with their own shop (owner). */
export async function owner(app: INestApplication, shop = SHOP): Promise<Session & { businessId: string }> {
  const s = await signUp(app);
  const res = await request(app.getHttpServer()).post('/api/businesses').set('Authorization', `Bearer ${s.token}`).send(shop).expect(201);
  return { token: res.body.accessToken, cookie: cookieOf(res), email: s.email, businessId: res.body.business.id };
}

/** Invite someone into the owner's shop with a role, and have them accept. */
export async function member(app: INestApplication, ownerS: Session, role: string): Promise<Session & { membershipId: string }> {
  const s = await signUp(app);
  const inv = await request(app.getHttpServer()).post('/api/members/invites').set('Authorization', `Bearer ${ownerS.token}`).send({ email: s.email, role }).expect(201);
  const acc = await request(app.getHttpServer()).post(`/api/invites/${inv.body.id}/accept`).set('Authorization', `Bearer ${s.token}`).send({ name: 'Staff ' + role }).expect(200);
  const list = await request(app.getHttpServer()).get('/api/members').set('Authorization', `Bearer ${ownerS.token}`).expect(200);
  const m = list.body.members.find((x: { email: string }) => x.email === s.email);
  return { token: acc.body.accessToken, cookie: cookieOf(acc), email: s.email, membershipId: m.id };
}

export { cookieOf };
export const auth = (s: { token: string }) => ({ Authorization: `Bearer ${s.token}` });

/**
 * Audit entries (or any response) never hold a passcode or its hash. Checked field by field, not by
 * searching the whole text: a short passcode like 4826 can turn up inside a random id or a time.
 * - no field named like passcode, hash or secret (a plain `pin` is a postal PIN code and is allowed);
 * - no field named like passcode, pin or code holds the passcode itself.
 */
export function expectNoPasscode(value: unknown, passcode: string): void {
  const bad: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/passcode|hash|secret/i.test(k)) bad.push(`${at}.${k} (field name)`);
      if (/passcode|pin|code/i.test(k) && (typeof x === 'string' || typeof x === 'number') && String(x) === passcode) bad.push(`${at}.${k} (holds the passcode)`);
      walk(x, `${at}.${k}`);
    }
  };
  walk(value, '$');
  expect(bad).toEqual([]);
}
