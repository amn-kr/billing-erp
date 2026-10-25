import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import type { ChangePasswordInput, LoginInput, RegisterInput } from '@billing/shared';
import type { RequestContext } from '../../common/context';
import { config } from '../../config';
import { DbService } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { Issued, sha256, TokensService } from './tokens.service';
import { hashPassword } from './password';

/** Used so a wrong email takes as long as a wrong password. */
let DUMMY_HASH: Promise<string> | null = null;

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  hashPassword(pw: string): Promise<string> {
    return hashPassword(pw);
  }

  /** The shop a person lands in after signing in: the one they used last, else their first. */
  private async defaultBusiness(userId: string, email: string): Promise<string | null> {
    const last = await this.db.session.findFirst({ where: { userId, businessId: { not: null } }, orderBy: { createdAt: 'desc' } });
    const ms = await this.db.scoped({ userId, email }, (tx) =>
      tx.membership.findMany({ where: { userId, status: 'active' }, orderBy: { createdAt: 'asc' }, select: { businessId: true } }),
    );
    if (last?.businessId && ms.some((m) => m.businessId === last.businessId)) return last.businessId;
    return ms[0]?.businessId ?? null;
  }

  async register(input: RegisterInput, meta: { ua: string; ip: string }): Promise<Issued> {
    const exists = await this.db.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException({ message: 'An account with this email already exists. Sign in instead.' });
    const user = await this.db.user.create({ data: { email: input.email, name: input.name, passwordHash: await this.hashPassword(input.password), lastLoginAt: new Date() } });
    return this.tokens.start(user, null, meta);
  }

  async login(input: LoginInput, meta: { ua: string; ip: string }): Promise<Issued> {
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    if (!user) {
      DUMMY_HASH ??= this.hashPassword('not-a-real-password');
      await verify(await DUMMY_HASH, input.password).catch(() => false);
      throw new UnauthorizedException({ message: 'Email or password is wrong.' });
    }
    const ok = await verify(user.passwordHash, input.password).catch(() => false);
    if (!ok) throw new UnauthorizedException({ message: 'Email or password is wrong.' });
    if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
      throw new UnauthorizedException({ message: 'This temporary password has expired. Ask the shop owner for a new one.' });
    }
    await this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const bid = await this.defaultBusiness(user.id, user.email);
    if (bid) {
      await this.db.scoped({ businessId: bid, userId: user.id, email: user.email }, (tx) =>
        this.audit.log(tx, { businessId: bid, userId: user.id, action: 'sign_in', entity: 'user', entityId: user.id, ip: meta.ip }),
      );
    }
    return this.tokens.start(user, bid, meta);
  }

  async demo(meta: { ua: string; ip: string }): Promise<Issued> {
    if (!config().DEMO_ENABLED) throw new NotFoundException({ message: 'The demo shop is not available.' });
    const user = await this.db.user.findUnique({ where: { email: config().DEMO_EMAIL } });
    if (!user) throw new NotFoundException({ message: 'The demo shop is not set up yet.' });
    return this.tokens.start(user, await this.defaultBusiness(user.id, user.email), meta);
  }

  /**
   * Always answers the same way, so nobody can find out which emails have accounts.
   * Sending the email needs a mail provider (not chosen yet) — until then the
   * link is written to the server log in development only.
   */
  async forgot(email: string): Promise<void> {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user) return;
    const token = randomBytes(32).toString('base64url');
    await this.db.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3_600_000) } });
    if (config().NODE_ENV === 'development') this.log.log(`Password reset link for ${email}: /reset?token=${token}`);
  }

  async reset(token: string, password: string): Promise<void> {
    const r = await this.db.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!r || r.usedAt || r.expiresAt < new Date()) throw new UnauthorizedException({ message: 'This reset link has expired. Ask for a new one.' });
    await this.db.$transaction([
      this.db.user.update({ where: { id: r.userId }, data: { passwordHash: await this.hashPassword(password), mustChangePassword: false, tempPasswordExpiresAt: null } }),
      this.db.passwordReset.update({ where: { id: r.id }, data: { usedAt: new Date() } }),
      this.db.session.updateMany({ where: { userId: r.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  /**
   * "Choose a new password" (after a temporary one from the shop owner). Needs the current password;
   * the person's other sign-ins end, this one carries on.
   */
  async changePassword(ctx: RequestContext, input: ChangePasswordInput): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (!(await verify(user.passwordHash, input.current).catch(() => false))) throw new BadRequestException({ message: 'The current password is wrong.', field: 'current' });
    if (input.password === input.current) throw new BadRequestException({ message: 'Choose a new password, not the temporary one.', field: 'password' });
    await this.db.$transaction([
      this.db.user.update({ where: { id: user.id }, data: { passwordHash: await this.hashPassword(input.password), mustChangePassword: false, tempPasswordExpiresAt: null } }),
      this.db.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } }),
    ]);
    if (ctx.businessId) {
      await this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, (tx) =>
        this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'password_changed', entity: 'user', entityId: ctx.userId, ip: ctx.ip }),
      );
    }
  }
}
