import { Injectable, NotFoundException } from '@nestjs/common';
import { todayIst, type OwnerCustomer, type OwnerCustomers, type ShopStatus } from '@billing/shared';
import { planToday } from '../config';
import { DbService, type Tx } from '../common/db.service';
import { OwnerAuditService } from './owner-audit.service';
import type { OwnerContext } from './owner.guard';

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

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
