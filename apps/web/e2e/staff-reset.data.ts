/** Staff for the Team card tests (Settings › General › Team), made through the API. */
import { request as playwrightRequest } from '@playwright/test';
import { APP } from './setup';

export const STAFF_PASSWORD = 'staff password 1';
export const TEMP_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

let n = 0;
const email = (tag: string) => `${tag}.${Date.now().toString(36)}.${process.pid}.${++n}@team.example.com`;

/**
 * The shop owner (`owner`) invites a new person, who joins as `name`. With `ownShop` the person first
 * sets up a shop of their own, so their account is used in another shop too.
 * Its own connection: signing in here must not sign in the test's browser.
 */
export async function addStaff(owner: { email: string; password: string }, name: string, opts: { ownShop?: string } = {}): Promise<{ email: string; password: string }> {
  const api = await playwrightRequest.newContext();
  try {
    const post = async (path: string, data: unknown, token?: string) => {
      const r = await api.post(APP + '/api' + path, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok()) throw new Error(`${path} failed: ${r.status()} ${await r.text()}`);
      return r.json() as Promise<{ accessToken: string; id: string }>;
    };
    const who = { email: email(name.split(' ')[0]!.toLowerCase()), password: STAFF_PASSWORD };
    const ownerTok = (await post('/auth/login', owner)).accessToken;
    let tok = (await post('/auth/register', { ...who, name })).accessToken;
    if (opts.ownShop) tok = (await post('/businesses', { name: opts.ownShop, owner: name, state: '09' }, tok)).accessToken;
    const inv = await post('/members/invites', { email: who.email, role: 'manager' }, ownerTok);
    await post(`/invites/${inv.id}/accept`, { name }, tok);
    return who;
  } finally {
    await api.dispose();
  }
}

/** An invite nobody has accepted yet. */
export async function inviteOnly(owner: { email: string; password: string }, tag: string): Promise<string> {
  const api = await playwrightRequest.newContext();
  try {
    const login = await api.post(APP + '/api/auth/login', { data: owner });
    const e = email(tag);
    const r = await api.post(APP + '/api/members/invites', { data: { email: e, role: 'manager' }, headers: { Authorization: `Bearer ${(await login.json()).accessToken}` } });
    if (!r.ok()) throw new Error(`invite failed: ${r.status()} ${await r.text()}`);
    return e;
  } finally {
    await api.dispose();
  }
}
