import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, signUp, startApp, uniqueEmail } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

describe('invites', () => {
  it('owner invites; the invited person sees it and joins with the right role', async () => {
    const o = await owner(app);
    const s = await signUp(app);
    const inv = await http().post('/api/members/invites').set(auth(o)).send({ email: s.email.toUpperCase(), role: 'accountant' }).expect(201);
    expect(inv.body.email).toBe(s.email);
    const me = await http().get('/api/me').set(auth(s)).expect(200);
    expect(me.body.invites).toEqual([{ id: inv.body.id, businessName: 'Gupta Electricals & Hardware', role: 'accountant' }]);
    const acc = await http().post(`/api/invites/${inv.body.id}/accept`).set(auth(s)).send({ name: 'Neha CA' }).expect(200);
    const me2 = await http().get('/api/me').set('Authorization', `Bearer ${acc.body.accessToken}`).expect(200);
    expect(me2.body.business.id).toBe(o.businessId);
    expect(me2.body.role).toBe('accountant');
    expect(me2.body.permissions).toContain('reports.view');
    expect(me2.body.permissions).not.toContain('members.manage');
    // cannot be used twice
    await http().post(`/api/invites/${inv.body.id}/accept`).set(auth(s)).send({ name: 'Neha' }).expect(404);
  });
  it('an invite for someone else cannot be accepted', async () => {
    const o = await owner(app);
    const inv = await http().post('/api/members/invites').set(auth(o)).send({ email: uniqueEmail(), role: 'manager' }).expect(201);
    const stranger = await signUp(app);
    await http().post(`/api/invites/${inv.body.id}/accept`).set(auth(stranger)).send({ name: 'X' }).expect(404);
  });
  it('no second owner, no duplicates', async () => {
    const o = await owner(app);
    const r = await http().post('/api/members/invites').set(auth(o)).send({ email: uniqueEmail(), role: 'owner' }).expect(400);
    expect(r.body.message).toBe('A shop has one owner. Choose another role.');
    const email = uniqueEmail();
    await http().post('/api/members/invites').set(auth(o)).send({ email, role: 'manager' }).expect(201);
    await http().post('/api/members/invites').set(auth(o)).send({ email, role: 'manager' }).expect(409);
    await http().post('/api/members/invites').set(auth(o)).send({ email: o.email, role: 'manager' }).expect(409);
  });
  it('a revoked invite disappears', async () => {
    const o = await owner(app);
    const s = await signUp(app);
    const inv = await http().post('/api/members/invites').set(auth(o)).send({ email: s.email, role: 'manager' }).expect(201);
    await http().post(`/api/members/invites/${inv.body.id}/revoke`).set(auth(o)).expect(204);
    const me = await http().get('/api/me').set(auth(s)).expect(200);
    expect(me.body.invites).toEqual([]);
    await http().post(`/api/invites/${inv.body.id}/accept`).set(auth(s)).send({ name: 'X' }).expect(404);
  });
});

describe('what each role may do', () => {
  it('billing staff cannot see or manage members', async () => {
    const o = await owner(app);
    const staff = await member(app, o, 'billing_staff');
    await http().get('/api/members').set(auth(staff)).expect(403);
    await http().post('/api/members/invites').set(auth(staff)).send({ email: uniqueEmail(), role: 'manager' }).expect(403);
    await http().get('/api/audit').set(auth(staff)).expect(403);
  });
  it('a manager can invite; an accountant can view members but not invite', async () => {
    const o = await owner(app);
    const mgr = await member(app, o, 'manager');
    await http().post('/api/members/invites').set(auth(mgr)).send({ email: uniqueEmail(), role: 'billing_staff' }).expect(201);
    const acc = await member(app, o, 'accountant');
    await http().get('/api/members').set(auth(acc)).expect(200);
    await http().post('/api/members/invites').set(auth(acc)).send({ email: uniqueEmail(), role: 'billing_staff' }).expect(403);
  });
});

describe('changing roles and removing people', () => {
  it('role change applies on the next request, without signing in again', async () => {
    const o = await owner(app);
    const s = await member(app, o, 'billing_staff');
    await http().get('/api/members').set(auth(s)).expect(403);
    await http().patch(`/api/members/${s.membershipId}/role`).set(auth(o)).send({ role: 'manager' }).expect(204);
    await http().get('/api/members').set(auth(s)).expect(200);
  });
  it('a removed person loses access at once', async () => {
    const o = await owner(app);
    const s = await member(app, o, 'manager');
    await http().post(`/api/members/${s.membershipId}/remove`).set(auth(o)).expect(204);
    const res = await http().get('/api/me').set(auth(s)).expect(403);
    expect(res.body.code).toBe('removed');
    await http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
  });
  it('the owner cannot be changed or removed, and nobody changes their own role', async () => {
    const o = await owner(app);
    const mgr = await member(app, o, 'manager');
    const list = await http().get('/api/members').set(auth(o)).expect(200);
    const ownerRow = list.body.members.find((m: { role: string }) => m.role === 'owner');
    await http().post(`/api/members/${ownerRow.id}/remove`).set(auth(mgr)).expect(403);
    await http().patch(`/api/members/${ownerRow.id}/role`).set(auth(mgr)).send({ role: 'billing_staff' }).expect(403);
    await http().patch(`/api/members/${mgr.membershipId}/role`).set(auth(mgr)).send({ role: 'accountant' }).expect(403);
    await http().patch(`/api/members/${mgr.membershipId}/role`).set(auth(o)).send({ role: 'owner' }).expect(400);
  });
});

describe('GET /api/roles', () => {
  it('lists the four roles with their permissions', async () => {
    const o = await owner(app);
    const res = await http().get('/api/roles').set(auth(o)).expect(200);
    expect(res.body.map((r: { key: string }) => r.key).sort()).toEqual(['accountant', 'billing_staff', 'manager', 'owner']);
  });
});

describe('GET /api/audit', () => {
  it('records shop creation, invites, joins and role changes', async () => {
    const o = await owner(app);
    const s = await member(app, o, 'billing_staff');
    await http().patch(`/api/members/${s.membershipId}/role`).set(auth(o)).send({ role: 'accountant' }).expect(204);
    const res = await http().get('/api/audit').set(auth(o)).expect(200);
    const actions = res.body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'invite', 'join', 'role_change']));
    const rc = res.body.find((a: { action: string }) => a.action === 'role_change');
    expect(rc.before).toEqual({ role: 'billing_staff' });
    expect(rc.after).toEqual({ role: 'accountant' });
  });
});
