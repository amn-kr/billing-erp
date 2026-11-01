import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, money, planEndsOn, todayIst, toDb, type OwnerCustomer, type OwnerCustomerDetail, type OwnerCustomers, type OwnerPayment, type OwnerPlanInput, type ShopStatus } from '@billing/shared';
import { planToday } from '../config';
import { DbService, type Tx } from '../common/db.service';
import { OwnerAuditService } from './owner-audit.service';
import type { OwnerContext } from './owner.guard';

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const day = (iso: string) => new Date(iso + 'T00:00:00Z');

/** Only these columns of a shop ever leave the database for the panel. */
const SHOP = { id: true, code: true, name: true, phone: true, email: true, ownerId: true, planStatus: true, trialEndsOn: true, paidUntil: true, status: true, createdAt: true } as const;

/**
 * The panel's customers: each shop's name, contact, type, plan and status. Runs with the panel's database
 * setting (app.owner_admin_id), which row-level security lets read shops and members only — never a shop's
 * invoices, parties, items or payments.
 */
@Injectable()
export class OwnerCustomersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: OwnerAuditService,
  ) {}

  private scoped<T>(o: OwnerContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.owner_admin_id', ${o.adminId}, true), set_config('app.business_id', '', true),
                                set_config('app.user_id', '', true), set_config('app.user_email', '', true)`;
      return fn(tx);
    });
  }

  list(o: OwnerContext): Promise<OwnerCustomers> {
    return this.scoped(o, async (tx) => {
      const shops = await tx.business.findMany({ select: SHOP, orderBy: { createdAt: 'desc' } });
      const people = await this.ownersOf(tx, shops);
      return { today: planToday(), customers: shops.map((b) => this.row(b, people)) };
    });
  }

  async setStatus(o: OwnerContext, id: string, status: ShopStatus): Promise<OwnerCustomer> {
    return this.scoped(o, async (tx) => {
      const b = await tx.business.findUnique({ where: { id }, select: SHOP });
      if (!b) throw new NotFoundException({ message: 'That customer no longer exists.' });
      let after = b;
      if (b.status !== status) {
        after = await tx.business.update({ where: { id }, data: { status, suspendedAt: status === 'suspended' ? new Date() : null }, select: SHOP });
        await this.audit.log({ adminId: o.adminId, action: status === 'suspended' ? 'suspend' : 'reactivate', businessId: id, entity: 'business', entityId: id, before: { status: b.status }, after: { status }, ip: o.ip }, tx);
      }
      return this.row(after, await this.ownersOf(tx, [after]));
    });
  }

  /** The drawer: the customer and their payments, newest first. */
  detail(o: OwnerContext, id: string): Promise<OwnerCustomerDetail> {
    return this.scoped(o, async (tx) => {
      const b = await this.shop(tx, id);
      return { customer: this.row(b, await this.ownersOf(tx, [b])), payments: await this.payments(tx, id) };
    });
  }

  /**
   * Activate or renew the paid plan with a payment received: a subscription for the period, its payment, and the
   * shop's "paid until" moved to the period's last day. A suspended shop is reactivated first (as in the design).
   */
  plan(o: OwnerContext, id: string, input: OwnerPlanInput & { months: number; reference: string }): Promise<OwnerCustomerDetail> {
    return this.scoped(o, async (tx) => {
      const b = await this.shop(tx, id);
      if (b.status === 'suspended') throw new BadRequestException({ message: 'Reactivate the account first.' });
      const today = planToday();
      const endsOn = planEndsOn(input.startsOn, input.months);
      const renew = b.planStatus === 'paid' && !!b.paidUntil && isoOf(b.paidUntil) >= today;
      const plan = await tx.plan.findUniqueOrThrow({ where: { code: 'paid' } });
      const sub = await tx.subscription.create({
        data: { businessId: id, planId: plan.id, status: 'active', billingPeriod: input.months === 12 ? 'year' : 'month', months: input.months, startsOn: day(input.startsOn), endsOn: day(endsOn), createdBy: o.adminId },
      });
      const amount = toDb(money(input.amount));
      // like the design, a cash payment without a reference is listed as "Cash"
      const reference = input.reference.trim() || (input.paidBy === 'Cash' ? 'Cash' : '');
      await tx.subscriptionPayment.create({
        data: { businessId: id, subscriptionId: sub.id, amount, status: 'paid', paidAt: new Date(), paidOn: day(today), paidBy: input.paidBy, reference, createdBy: o.adminId },
      });
      const after = await tx.business.update({ where: { id }, data: { planStatus: 'paid', paidUntil: day(endsOn) }, select: SHOP });
      await this.audit.log({
        adminId: o.adminId, action: renew ? 'plan_renewed' : 'plan_activated', businessId: id, entity: 'business', entityId: id, ip: o.ip,
        before: { plan: b.planStatus, paidUntil: b.paidUntil ? isoOf(b.paidUntil) : null },
        after: { plan: 'paid', startsOn: input.startsOn, paidUntil: endsOn, months: input.months, amount, paidBy: input.paidBy, reference },
      }, tx);
      return { customer: this.row(after, await this.ownersOf(tx, [after])), payments: await this.payments(tx, id) };
    });
  }

  /** "Extend trial by 7 days": from the trial's end, or from today when it has already ended (only before a plan). */
  extendTrial(o: OwnerContext, id: string): Promise<OwnerCustomerDetail> {
    return this.scoped(o, async (tx) => {
      const b = await this.shop(tx, id);
      if (b.status === 'suspended') throw new BadRequestException({ message: 'Reactivate the account first.' });
      if (b.planStatus === 'paid') throw new BadRequestException({ message: 'This customer already has a plan.' });
      const today = planToday();
      const from = isoOf(b.trialEndsOn) >= today ? isoOf(b.trialEndsOn) : today;
      const trialEndsOn = addDays(from, 7);
      const after = await tx.business.update({ where: { id }, data: { trialEndsOn: day(trialEndsOn) }, select: SHOP });
      await this.audit.log({ adminId: o.adminId, action: 'trial_extended', businessId: id, entity: 'business', entityId: id, before: { trialEndsOn: isoOf(b.trialEndsOn) }, after: { trialEndsOn }, ip: o.ip }, tx);
      return { customer: this.row(after, await this.ownersOf(tx, [after])), payments: await this.payments(tx, id) };
    });
  }

  private async shop(tx: Tx, id: string) {
    const b = await tx.business.findUnique({ where: { id }, select: SHOP });
    if (!b) throw new NotFoundException({ message: 'That customer no longer exists.' });
    return b;
  }

  private async payments(tx: Tx, id: string): Promise<OwnerPayment[]> {
    const rows = await tx.subscriptionPayment.findMany({ where: { businessId: id, status: 'paid' }, include: { subscription: true }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }] });
    return rows.map((p) => ({
      id: p.id, paidOn: isoOf(p.paidOn ?? p.createdAt), months: p.subscription.months, amount: p.amount.toFixed(2), paidBy: p.paidBy, reference: p.reference,
      startsOn: isoOf(p.subscription.startsOn), endsOn: isoOf(p.subscription.endsOn),
    }));
  }

  /** each shop owner's name (as the shop shows it), sign-in email and phone */
  private async ownersOf(tx: Tx, shops: { id: string; ownerId: string }[]) {
    const ids = shops.map((s) => s.ownerId);
    const [users, members] = await Promise.all([
      tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, phone: true } }),
      tx.membership.findMany({ where: { userId: { in: ids }, businessId: { in: shops.map((s) => s.id) } }, select: { businessId: true, userId: true, displayName: true } }),
    ]);
    return { users: new Map(users.map((u) => [u.id, u])), names: new Map(members.map((m) => [`${m.businessId}|${m.userId}`, m.displayName])) };
  }

  private row(b: { id: string; code: string; name: string; phone: string; email: string; ownerId: string; planStatus: string; trialEndsOn: Date; paidUntil: Date | null; status: string; createdAt: Date }, people: Awaited<ReturnType<OwnerCustomersService['ownersOf']>>): OwnerCustomer {
    const u = people.users.get(b.ownerId);
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      ownerName: people.names.get(`${b.id}|${b.ownerId}`) || u?.name || '',
      mobile: (b.phone || u?.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''),
      email: b.email || u?.email || '',
      businessType: 'General',
      via: 'email',
      enrolled: todayIst(b.createdAt),
      plan: b.planStatus === 'paid' ? 'paid' : 'trial',
      trialEndsOn: isoOf(b.trialEndsOn),
      paidUntil: b.paidUntil ? isoOf(b.paidUntil) : null,
      status: b.status === 'suspended' ? 'suspended' : 'active',
    };
  }
}
