/**
 * Owner panel, part 2 (owner's request, 1 Nov 2026): activate or renew a shop's paid plan with a payment received
 * (amount typed, paid by, reference), the payment history, and "Extend trial by 7 days". The shop app then shows
 * "Paid · till …" from the same fields as before. Every change is in owner_audit_log and in the shop's backup list.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, owner, startApp, uniqueEmail } from './helpers';
import { TEST_DB } from './env';

const OWNER_PW = 'owner password 123';
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

async function panel(): Promise<{ id: string; token: string }> {
  const { hashPassword } = await import('../src/modules/auth/password');
  const a = await db.superAdmin.create({ data: { email: uniqueEmail('owner'), name: 'Panel Owner', passwordHash: await hashPassword(OWNER_PW) } });
  const r = await http().post('/api/auth/login').send({ email: a.email, password: OWNER_PW }).expect(200);
  return { id: a.id, token: r.body.accessToken };
}
const { todayIst } = await import('@billing/shared');
const today = () => todayIst();
const plus = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
const pay = (p: { token: string }, id: string, body: Record<string, unknown>) => http().post(`/api/owner/customers/${id}/plan`).set(auth(p)).send({ months: 1, startsOn: today(), paidBy: 'UPI', amount: '1500', reference: 'UPI 4521 8890', ...body });

describe('plans and payments', () => {
  it('activate: a paid plan till the period’s last day, the payment listed; the shop sees “Paid”', async () => {
    const p = await panel();
    const o = await owner(app);
    const start = today();
    const r = await pay(p, o.businessId, { months: 3, startsOn: start, amount: '1,499.50' }).expect(200);
    const end = (await import('@billing/shared')).planEndsOn(start, 3);
    expect(r.body.customer).toMatchObject({ plan: 'paid', paidUntil: end, status: 'active' });
    expect(r.body.payments).toEqual([{ id: expect.any(String), paidOn: start, months: 3, amount: '1499.50', paidBy: 'UPI', reference: 'UPI 4521 8890', startsOn: start, endsOn: end }]);
    expect((await http().get(`/api/owner/customers/${o.businessId}`).set(auth(p)).expect(200)).body).toEqual(r.body);

    const me = await http().get('/api/me').set(auth(o)).expect(200);
    expect(me.body.business).toMatchObject({ plan: 'paid', planEndsOn: end });

    const log = await db.ownerAuditLog.findMany({ where: { adminId: p.id, businessId: o.businessId } });
    expect(log.map((e) => e.action)).toEqual(['plan_activated']);
    expect(log[0]!.after).toMatchObject({ plan: 'paid', paidUntil: end, months: 3, amount: '1499.50', paidBy: 'UPI', reference: 'UPI 4521 8890' });
  });

  it('renew from the day after the plan ends; newest payment first; cash without a reference shows “Cash”', async () => {
    const p = await panel();
    const o = await owner(app);
    const first = await pay(p, o.businessId, {}).expect(200);
    const next = plus(first.body.customer.paidUntil, 1);
    const r = await pay(p, o.businessId, { months: 12, startsOn: next, paidBy: 'Cash', reference: '', amount: '9990' }).expect(200);
    expect(r.body.customer.paidUntil > first.body.customer.paidUntil).toBe(true);
    expect(r.body.payments.map((x: { months: number; paidBy: string; reference: string; amount: string }) => [x.months, x.paidBy, x.reference, x.amount])).toEqual([
      [12, 'Cash', 'Cash', '9990.00'],
      [1, 'UPI', 'UPI 4521 8890', '1500.00'],
    ]);
    const log = await db.ownerAuditLog.findMany({ where: { adminId: p.id, businessId: o.businessId }, orderBy: { createdAt: 'asc' } });
    expect(log.map((e) => e.action)).toEqual(['plan_activated', 'plan_renewed']);
  });

  it('the form’s rules are checked by the server too; nothing is saved on a mistake', async () => {
    const p = await panel();
    const o = await owner(app);
    expect((await pay(p, o.businessId, { reference: '' }).expect(400)).body.message).toBe('Enter the UPI reference so you can match this payment later.');
    expect((await pay(p, o.businessId, { amount: '0' }).expect(400)).body.message).toBe('Enter the amount received, like 1500 or 1500.50.');
    await pay(p, o.businessId, { months: 2 }).expect(400);
    await pay(p, o.businessId, { startsOn: '2026-02-30' }).expect(400);
    expect((await http().get(`/api/owner/customers/${o.businessId}`).set(auth(p)).expect(200)).body).toMatchObject({ customer: { plan: 'trial', paidUntil: null }, payments: [] });
  });

  it('a suspended shop must be reactivated before a plan or trial change', async () => {
    const p = await panel();
    const o = await owner(app);
    await http().post(`/api/owner/customers/${o.businessId}/suspend`).set(auth(p)).expect(200);
    expect((await pay(p, o.businessId, {}).expect(400)).body.message).toBe('Reactivate the account first.');
    await http().post(`/api/owner/customers/${o.businessId}/extend-trial`).set(auth(p)).expect(400);
    expect(await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.business_id', ${o.businessId}, true)`;
      return tx.subscriptionPayment.count();
    })).toBe(0);
  });

  it('extend trial: 7 days from the trial’s end, or from today once it has ended; not after a plan', async () => {
    const p = await panel();
    const o = await owner(app);
    const before = (await http().get(`/api/owner/customers/${o.businessId}`).set(auth(p)).expect(200)).body.customer.trialEndsOn as string;
    const r = await http().post(`/api/owner/customers/${o.businessId}/extend-trial`).set(auth(p)).expect(200);
    expect(r.body.customer.trialEndsOn).toBe(plus(before, 7));

    // a trial that ended last week: 7 days from today
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.business_id', ${o.businessId}, true)`;
      await tx.business.update({ where: { id: o.businessId }, data: { trialEndsOn: new Date(plus(today(), -6) + 'T00:00:00Z') } });
    });
    const r2 = await http().post(`/api/owner/customers/${o.businessId}/extend-trial`).set(auth(p)).expect(200);
    expect(r2.body.customer.trialEndsOn).toBe(plus(today(), 7));
    const log = await db.ownerAuditLog.findMany({ where: { adminId: p.id, businessId: o.businessId, action: 'trial_extended' } });
    expect(log).toHaveLength(2);

    await pay(p, o.businessId, {}).expect(200);
    expect((await http().post(`/api/owner/customers/${o.businessId}/extend-trial`).set(auth(p)).expect(400)).body.message).toBe('This customer already has a plan.');
  });

  it('shop tokens can’t see or add payments; the shop’s own backup list gets the new rows', async () => {
    const p = await panel();
    const o = await owner(app);
    await http().get(`/api/owner/customers/${o.businessId}`).set(auth(o)).expect(401);
    await pay(o, o.businessId, {}).expect(401);
    await http().post(`/api/owner/customers/${o.businessId}/extend-trial`).set(auth(o)).expect(401);
    await pay(p, o.businessId, {}).expect(200);
    const tables = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.business_id', ${o.businessId}, true)`;
      return (await tx.changeLog.findMany({ where: { tbl: { in: ['subscriptions', 'subscription_payments'] } } })).map((c) => c.tbl).sort();
    });
    expect(tables).toEqual(['subscription_payments', 'subscriptions']);
  });

  it('an unknown customer is a clear error', async () => {
    const p = await panel();
    await http().get('/api/owner/customers/00000000-0000-4000-8000-000000000000').set(auth(p)).expect(404);
    await pay(p, '00000000-0000-4000-8000-000000000000', {}).expect(404);
  });
});
