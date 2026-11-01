/**
 * Settings › Features (owner's request, 1 Nov 2026): every shop starts with everything off; only the shop's
 * owner can change it, also in the API; a feature can't be on without what it needs; each change is in the
 * audit log.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, member, owner, signUp, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = { token: string };
const ALL = ['batch_expiry', 'mrp_pack', 'medical'];
const save = (s: S, enabled: unknown) => http().put('/api/settings/features').set(auth(s)).send({ enabled });
const features = async (s: S) => (await http().get('/api/me').set(auth(s)).expect(200)).body.business.features as string[];
interface Entry { action: string; entity: string; entityId: string | null; userId: string | null; createdAt: string; before: unknown; after: unknown }
const log = async (o: S) => ((await http().get('/api/audit?limit=200').set(auth(o)).expect(200)).body as Entry[]).filter((e) => e.entity === 'feature');

describe('features', () => {
  it('a new shop starts with everything off, for the owner and for staff', async () => {
    const o = await owner(app);
    expect(await features(o)).toEqual([]);
    expect(await features(await member(app, o, 'billing_staff'))).toEqual([]);
  });

  it('the owner’s change reaches everyone in the shop', async () => {
    const o = await owner(app);
    const staff = await member(app, o, 'billing_staff');
    expect((await save(o, ['mrp_pack']).expect(200)).body).toEqual({ features: ['mrp_pack'] });
    expect(await features(o)).toEqual(['mrp_pack']);
    expect(await features(staff)).toEqual(['mrp_pack']);
  });

  it.each(['manager', 'billing_staff', 'accountant'])('%s is refused, and nothing changes', async (role) => {
    const o = await owner(app);
    const s = await member(app, o, role);
    expect((await save(s, ['mrp_pack']).expect(403)).body.message).toBe('Only the shop owner can change features.');
    expect(await features(o)).toEqual([]);
    expect(await log(o)).toEqual([]);
  });

  it('someone without a shop is refused', async () => {
    await save(await signUp(app), []).expect(403);
  });

  it('being the owner of one shop gives no say in another, and shops don’t affect each other', async () => {
    const a = await owner(app);
    const b = await owner(app);
    const inv = await http().post('/api/members/invites').set(auth(b)).send({ email: a.email, role: 'manager' }).expect(201);
    const inB = { token: (await http().post(`/api/invites/${inv.body.id}/accept`).set(auth(a)).send({ name: 'Ravi' }).expect((r) => expect(r.status).toBeLessThan(300))).body.accessToken as string };
    await save(inB, ['mrp_pack']).expect(403);
    expect(await features(b)).toEqual([]);
    await save(a, ['batch_expiry']).expect(200);
    expect(await features(b)).toEqual([]);
  });

  it('a feature can’t be on without what it needs', async () => {
    const o = await owner(app);
    expect((await save(o, ['medical']).expect(400)).body.message).toBe('Medical needs Batch and expiry. Turn that on first.');
    await save(o, ['batch_expiry', 'medical']).expect(400);
    expect(await features(o)).toEqual([]);
    await save(o, ALL).expect(200);
    // the same rule keeps the other two on while Medical is on
    await save(o, ['mrp_pack', 'medical']).expect(400);
    await save(o, ['batch_expiry', 'medical']).expect(400);
    expect(await features(o)).toEqual(ALL);
  });

  it('Medical off leaves the other two on, and then they change on their own', async () => {
    const o = await owner(app);
    await save(o, ALL).expect(200);
    await save(o, ['batch_expiry', 'mrp_pack']).expect(200);
    await save(o, ['mrp_pack']).expect(200);
    expect(await features(o)).toEqual(['mrp_pack']);
    await save(o, []).expect(200);
    expect(await features(o)).toEqual([]);
  });

  it('refuses unknown features and anything but a list', async () => {
    const o = await owner(app);
    expect((await save(o, ['nope']).expect(400)).body.message).toBe('That feature does not exist.');
    await save(o, 'medical').expect(400);
    await http().put('/api/settings/features').set(auth(o)).send({ enabled: [], extra: true }).expect(400);
  });

  it('every change is in the audit log: who, when, which feature, on or off; saving the same list adds nothing', async () => {
    const o = await owner(app);
    const myId = (await http().get('/api/me').set(auth(o)).expect(200)).body.user.id as string;
    await save(o, ALL).expect(200);
    await save(o, ALL).expect(200);
    let e = await log(o);
    expect(e).toHaveLength(3);
    expect(e.map((x) => x.entityId).sort()).toEqual([...ALL].sort());
    for (const x of e) {
      expect(x).toMatchObject({ action: 'update', userId: myId, before: { on: false }, after: { on: true } });
      expect(Number.isNaN(Date.parse(x.createdAt))).toBe(false);
    }
    await save(o, ['batch_expiry', 'mrp_pack']).expect(200);
    e = await log(o);
    expect(e).toHaveLength(4);
    expect(e.find((x) => x.entityId === 'medical' && (x.after as { on: boolean }).on === false)).toMatchObject({ before: { on: true }, userId: myId });
  });

  it('the normal settings save, open to managers, can’t change features or lose them', async () => {
    const o = await owner(app);
    const m = await member(app, o, 'manager');
    await save(o, ['mrp_pack']).expect(200);
    await http().patch('/api/settings').set(auth(m)).send({ features: ALL }).expect((r) => expect(r.status).toBeLessThan(500));
    await http().patch('/api/settings').set(auth(m)).send({ data: { features: 'medical' } }).expect(200);
    await http().patch('/api/settings').set(auth(m)).send({ gstEnabled: true }).expect(200);
    expect(await features(o)).toEqual(['mrp_pack']);
  });
});
