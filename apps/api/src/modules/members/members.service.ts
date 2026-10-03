import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { InviteInput, RoleKey } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';

const INVITE_DAYS = 14;

@Injectable()
export class MembersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  private role(tx: Tx, key: RoleKey) {
    return tx.role.findFirstOrThrow({ where: { key, businessId: null } });
  }

  list(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const members = await tx.membership.findMany({
        where: { businessId: ctx.businessId! },
        include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } }, role: true },
        orderBy: { createdAt: 'asc' },
      });
      const invites = await tx.invite.findMany({
        where: { businessId: ctx.businessId!, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { role: true },
        orderBy: { createdAt: 'desc' },
      });
      return {
        members: members.map((m) => ({
          id: m.id, userId: m.userId, name: m.displayName || m.user.name, email: m.user.email, role: m.role.key, status: m.status,
          lastLoginAt: m.user.lastLoginAt, joinedAt: m.createdAt,
        })),
        invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role.key, expiresAt: i.expiresAt })),
      };
    });
  }

  invite(ctx: RequestContext, input: InviteInput) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const already = await tx.membership.findFirst({ where: { businessId: ctx.businessId!, status: 'active', user: { email: input.email } } });
      if (already) throw new ConflictException({ message: 'This person is already in your shop.' });
      const open = await tx.invite.findFirst({ where: { businessId: ctx.businessId!, email: input.email, acceptedAt: null, revokedAt: null } });
      if (open) throw new ConflictException({ message: 'An invite for this email is already waiting.' });
      const role = await this.role(tx, input.role);
      const inv = await tx.invite.create({
        data: { businessId: ctx.businessId!, email: input.email, roleId: role.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), createdBy: ctx.userId },
      });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'invite', entity: 'invite', entityId: inv.id, after: { email: inv.email, role: input.role }, ip: ctx.ip });
      return { id: inv.id, email: inv.email, role: input.role, expiresAt: inv.expiresAt };
    });
  }

  revokeInvite(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const inv = await tx.invite.findFirst({ where: { id, businessId: ctx.businessId! } });
      if (!inv || inv.acceptedAt || inv.revokedAt) throw new NotFoundException({ message: 'That invite is no longer open.' });
      await tx.invite.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'revoke_invite', entity: 'invite', entityId: id, before: { email: inv.email }, ip: ctx.ip });
    });
  }

  /** The invited person accepts. Returns the shop id so the caller can switch tokens to it. */
  async accept(ctx: RequestContext, inviteId: string, name: string): Promise<string> {
    const inv = await this.db.scoped({ userId: ctx.userId, email: ctx.email }, (tx) => tx.invite.findFirst({ where: { id: inviteId, email: ctx.email } }));
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new NotFoundException({ message: 'This invite is no longer open. Ask the shop owner to invite you again.' });
    await this.db.scoped({ businessId: inv.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const prev = await tx.membership.findFirst({ where: { businessId: inv.businessId, userId: ctx.userId } });
      const m = prev
        ? await tx.membership.update({ where: { id: prev.id }, data: { status: 'active', removedAt: null, roleId: inv.roleId, displayName: name } })
        : await tx.membership.create({ data: { businessId: inv.businessId, userId: ctx.userId, roleId: inv.roleId, displayName: name, createdBy: ctx.userId } });
      await tx.invite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      const u = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      if (!u.name) await tx.user.update({ where: { id: u.id }, data: { name } });
      await this.audit.log(tx, { businessId: inv.businessId, userId: ctx.userId, action: 'join', entity: 'membership', entityId: m.id, after: { name, inviteId }, ip: ctx.ip });
    });
    return inv.businessId;
  }

  private async target(tx: Tx, ctx: RequestContext, membershipId: string) {
    const m = await tx.membership.findFirst({ where: { id: membershipId, businessId: ctx.businessId! }, include: { role: true } });
    if (!m || m.status !== 'active') throw new NotFoundException({ message: 'That person is not in your shop.' });
    if (m.role.key === 'owner') throw new ForbiddenException({ message: 'The owner’s access can’t be changed.' });
    if (m.userId === ctx.userId) throw new ForbiddenException({ message: 'You can’t change your own access.' });
    return m;
  }

  changeRole(ctx: RequestContext, membershipId: string, role: RoleKey) {
    if (role === 'owner') throw new BadRequestException({ message: 'A shop has one owner. Choose another role.' });
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const m = await this.target(tx, ctx, membershipId);
      const r = await this.role(tx, role);
      await tx.membership.update({ where: { id: m.id }, data: { roleId: r.id } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'role_change', entity: 'membership', entityId: m.id, before: { role: m.role.key }, after: { role }, ip: ctx.ip });
    });
  }

  remove(ctx: RequestContext, membershipId: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const m = await this.target(tx, ctx, membershipId);
      await tx.membership.update({ where: { id: m.id }, data: { status: 'removed', removedAt: new Date() } });
      await tx.session.updateMany({ where: { userId: m.userId, businessId: ctx.businessId!, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'remove_member', entity: 'membership', entityId: m.id, before: { role: m.role.key, status: 'active' }, after: { status: 'removed' }, ip: ctx.ip });
    });
  }

  roles(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const roles = await tx.role.findMany({ include: { permissions: true }, orderBy: { createdAt: 'asc' } });
      return roles.map((r) => ({ key: r.key, name: r.name, system: r.businessId === null, permissions: r.permissions.map((p) => p.permission).sort() }));
    });
  }
}
