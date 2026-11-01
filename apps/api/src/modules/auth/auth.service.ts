import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import type { ChangePasswordInput, LoginInput, MakeRecoveryCodesInput, RecoverInput, RecoveryCodes, RecoveryCodesState, RegisterInput } from '@billing/shared';
import type { RequestContext } from '../../common/context';
import { config } from '../../config';
import { DbService } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { SHOP_PAUSED } from '../../common/auth.guard';
import { OwnerAuthService } from '../../owner';
import type { OwnerIssued } from '../../owner/owner-tokens.service';
import { Issued, sha256, TokensService } from './tokens.service';
import { hashPassword } from './password';
import { hashRecoveryCode, makeRecoveryCode, RECOVERY_CODE_COUNT, RECOVERY_MAX_TRIES, RECOVERY_WAIT_MINUTES } from './recovery-codes';

/** Used so a wrong email takes as long as a wrong password. */
let DUMMY_HASH: Promise<string> | null = null;

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly owner: OwnerAuthService,
  ) {}

  hashPassword(pw: string): Promise<string> {
    return hashPassword(pw);
  }

  /**
   * The shop a person lands in after signing in: the one they used last, else their first. Shops suspended in
   * the owner panel are skipped; someone whose every shop is suspended can't sign in.
   */
  private async defaultBusiness(userId: string, email: string): Promise<string | null> {
    const last = await this.db.session.findFirst({ where: { userId, businessId: { not: null } }, orderBy: { createdAt: 'desc' } });
    const all = await this.db.scoped({ userId, email }, (tx) =>
      tx.membership.findMany({ where: { userId, status: 'active' }, orderBy: { createdAt: 'asc' }, select: { businessId: true, business: { select: { status: true } } } }),
    );
    const ms = all.filter((m) => m.business.status !== 'suspended');
    if (all.length && !ms.length) throw new ForbiddenException({ message: SHOP_PAUSED, code: 'suspended' });
    if (last?.businessId && ms.some((m) => m.businessId === last.businessId)) return last.businessId;
    return ms[0]?.businessId ?? null;
  }

  async register(input: RegisterInput, meta: { ua: string; ip: string }): Promise<Issued> {
    // the software owner's email can't become a shop account either (same answer, so nothing is given away)
    const exists = (await this.db.user.findUnique({ where: { email: input.email } })) ?? (await this.owner.findAdmin(input.email));
    if (exists) throw new ConflictException({ message: 'An account with this email already exists. Sign in instead.' });
    const user = await this.db.user.create({ data: { email: input.email, name: input.name, passwordHash: await this.hashPassword(input.password), lastLoginAt: new Date() } });
    return this.tokens.start(user, null, meta);
  }

  /**
   * One sign-in page for everyone: shop users get shop tokens; the software owner (a separate table) gets a
   * panel sign-in instead. A wrong email or password gives the same words and takes the same time either way.
   */
  async login(input: LoginInput, meta: { ua: string; ip: string }): Promise<Issued | ({ owner: true } & OwnerIssued)> {
    const [user, admin] = await Promise.all([this.db.user.findUnique({ where: { email: input.email } }), this.owner.findAdmin(input.email)]);
    if (admin) return { owner: true, ...(await this.owner.signIn(admin, input.password, meta)) };
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

  /** Recovery codes card: unused codes left from the person's last set (a set shares its createdAt). */
  async recoveryState(ctx: RequestContext): Promise<RecoveryCodesState> {
    const last = await this.db.recoveryCode.findFirst({ where: { userId: ctx.userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (!last) return { left: 0, total: 0, madeAt: null };
    const codes = await this.db.recoveryCode.findMany({ where: { userId: ctx.userId, createdAt: last.createdAt }, select: { usedAt: true, replacedAt: true } });
    return { left: codes.filter((c) => !c.usedAt && !c.replacedAt).length, total: codes.length, madeAt: last.createdAt.toISOString() };
  }

  /**
   * Makes ten new recovery codes for the person's own account (after their password) and returns them
   * once; the unused old ones stop working. The shared demo account can't have codes.
   */
  async makeRecoveryCodes(ctx: RequestContext, input: MakeRecoveryCodesInput): Promise<RecoveryCodes> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (user.email === config().DEMO_EMAIL) throw new BadRequestException({ message: 'The demo shop can’t have recovery codes.' });
    if (!(await verify(user.passwordHash, input.password).catch(() => false))) throw new BadRequestException({ message: 'Your password is wrong.', field: 'password' });
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, makeRecoveryCode);
    const now = new Date();
    await this.db.$transaction([
      this.db.recoveryCode.updateMany({ where: { userId: user.id, usedAt: null, replacedAt: null }, data: { replacedAt: now } }),
      this.db.recoveryCode.createMany({ data: codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(user.id, c), createdAt: now })) }),
    ]);
    if (ctx.businessId) {
      await this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, (tx) =>
        this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'recovery_codes_made', entity: 'user', entityId: ctx.userId, after: { count: codes.length }, ip: ctx.ip }),
      );
    }
    return { codes, madeAt: now.toISOString() };
  }

  /**
   * "Use a recovery code" on the sign-in page: the email, one unused code and a new password. The code is
   * used up, every other sign-in ends, and the person is signed in. Five wrong codes in a row make the
   * account's codes wait 15 minutes; a wrong email gets the same answer as a wrong code.
   */
  async recover(input: RecoverInput, meta: { ua: string; ip: string }): Promise<Issued> {
    const wrong = () => new BadRequestException({ message: 'That email and recovery code don’t match.' });
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    if (!user || user.email === config().DEMO_EMAIL) throw wrong();
    const now = new Date();
    if (user.recoveryWaitUntil && user.recoveryWaitUntil > now) {
      throw new BadRequestException({ message: `Too many wrong codes. Try again in ${Math.ceil((user.recoveryWaitUntil.getTime() - now.getTime()) / 60_000)} minutes.` });
    }
    const code = await this.db.recoveryCode.findFirst({ where: { userId: user.id, codeHash: hashRecoveryCode(user.id, input.code), usedAt: null, replacedAt: null } });
    if (!code) {
      const fails = user.recoveryFails + 1;
      await this.db.user.update({
        where: { id: user.id },
        data: fails >= RECOVERY_MAX_TRIES ? { recoveryFails: 0, recoveryWaitUntil: new Date(now.getTime() + RECOVERY_WAIT_MINUTES * 60_000) } : { recoveryFails: fails },
      });
      throw wrong();
    }
    const passwordHash = await this.hashPassword(input.password);
    await this.db.$transaction([
      this.db.recoveryCode.update({ where: { id: code.id }, data: { usedAt: now } }),
      this.db.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null, recoveryFails: 0, recoveryWaitUntil: null, lastLoginAt: now } }),
      this.db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
      this.db.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    ]);
    const left = await this.db.recoveryCode.count({ where: { userId: user.id, usedAt: null, replacedAt: null } });
    const shops = await this.db.scoped({ userId: user.id, email: user.email }, (tx) =>
      tx.membership.findMany({ where: { userId: user.id, status: 'active' }, select: { businessId: true } }),
    );
    for (const m of shops) {
      await this.db.scoped({ businessId: m.businessId, userId: user.id, email: user.email }, (tx) =>
        this.audit.log(tx, { businessId: m.businessId, userId: user.id, action: 'password_recovered', entity: 'user', entityId: user.id, after: { codesLeft: left }, ip: meta.ip }),
      );
    }
    return this.tokens.start(user, await this.defaultBusiness(user.id, user.email), meta);
  }
}
