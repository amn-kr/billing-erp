import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { OwnerSetupInput } from '@billing/shared';
import type { SuperAdmin } from '@prisma/client';
import { config } from '../config';
import { DbService } from '../common/db.service';
import { hashPassword } from '../modules/auth/password';
import { OwnerAuditService } from './owner-audit.service';
import { OwnerTokensService, type OwnerIssued } from './owner-tokens.service';

/**
 * Wrong passwords in a row → the account is refused for a while (separate from the shop passcode rules):
 * minutes to lock after the n-th wrong password in a row: 5th → 15, 10th and later → 60, else none */
export const lockMinutes = (tries: number): number => (tries >= 10 ? 60 : tries === 5 ? 15 : 0);

/** The same words as a shop sign-in, so nobody can tell that an email belongs to the software owner. */
const WRONG = 'Email or password is wrong.';

const digest = (s: string) => createHash('sha256').update(s).digest();

@Injectable()
export class OwnerAuthService {
  constructor(
    private readonly db: DbService,
    private readonly tokens: OwnerTokensService,
    private readonly audit: OwnerAuditService,
  ) {}

  findAdmin(email: string): Promise<SuperAdmin | null> {
    return this.db.superAdmin.findUnique({ where: { email } });
  }

  /**
   * Sign-in on the shared page for an email that belongs to the software owner. The password is always
   * checked (same time as a shop sign-in); a locked account answers exactly like a wrong password.
   */
  async signIn(admin: SuperAdmin, password: string, meta: { ua: string; ip: string }): Promise<OwnerIssued> {
    const ok = await verify(admin.passwordHash, password).catch(() => false);
    const now = new Date();
    if (admin.lockedUntil && admin.lockedUntil > now) {
      await this.audit.log({ adminId: admin.id, action: 'sign_in_failed', entity: 'super_admin', entityId: admin.id, after: { locked: true, lockedUntil: admin.lockedUntil }, ip: meta.ip });
      throw new UnauthorizedException({ message: WRONG });
    }
    if (!ok) {
      const { failedTries } = await this.db.superAdmin.update({ where: { id: admin.id }, data: { failedTries: { increment: 1 } }, select: { failedTries: true } });
      await this.audit.log({ adminId: admin.id, action: 'sign_in_failed', entity: 'super_admin', entityId: admin.id, after: { tries: failedTries }, ip: meta.ip });
      const minutes = lockMinutes(failedTries);
      if (minutes) {
        const lockedUntil = new Date(now.getTime() + minutes * 60_000);
        await this.db.superAdmin.update({ where: { id: admin.id }, data: { lockedUntil } });
        await this.audit.log({ adminId: admin.id, action: 'locked', entity: 'super_admin', entityId: admin.id, after: { tries: failedTries, minutes, lockedUntil }, ip: meta.ip });
      }
      throw new UnauthorizedException({ message: WRONG });
    }
    await this.db.superAdmin.update({ where: { id: admin.id }, data: { failedTries: 0, lockedUntil: null, lastLoginAt: now } });
    const issued = await this.tokens.start(admin, meta);
    await this.audit.log({ adminId: admin.id, action: 'sign_in', entity: 'super_admin', entityId: admin.id, after: { sessionId: issued.sessionId }, ip: meta.ip });
    return issued;
  }

  /** Open only while OWNER_SETUP_CODE is set on the server and no software owner account exists yet. */
  async setupOpen(): Promise<boolean> {
    return !!config().OWNER_SETUP_CODE && (await this.db.superAdmin.count()) === 0;
  }

  async setup(input: OwnerSetupInput, ip: string): Promise<void> {
    const code = config().OWNER_SETUP_CODE;
    if (!code) throw new NotFoundException({ message: 'The setup page is closed.' });
    if (!timingSafeEqual(digest(input.code), digest(code))) throw new UnauthorizedException({ message: 'The setup code is wrong.', field: 'code' });
    if (await this.db.user.findUnique({ where: { email: input.email } })) {
      throw new ConflictException({ message: 'This email has a shop account. Use another email for the owner panel.', field: 'email' });
    }
    const passwordHash = await hashPassword(input.password);
    await this.db.$transaction(async (tx) => {
      // two setup pages sent at the same moment: only the first one makes the account
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('owner-panel-setup'))`;
      if ((await tx.superAdmin.count()) > 0) throw new NotFoundException({ message: 'The setup page is closed.' });
      const a = await tx.superAdmin.create({ data: { email: input.email, name: input.name, passwordHash } });
      await this.audit.log({ adminId: a.id, action: 'setup', entity: 'super_admin', entityId: a.id, after: { email: a.email, name: a.name }, ip }, tx);
    });
  }

  refresh(refreshToken: string, meta: { ua: string; ip: string }): Promise<OwnerIssued> {
    return this.tokens.rotate(refreshToken, meta);
  }

  async signOut(refreshToken: string, ip: string): Promise<void> {
    const adminId = await this.tokens.revokeByToken(refreshToken);
    if (adminId) await this.audit.log({ adminId, action: 'sign_out', entity: 'super_admin', entityId: adminId, ip });
  }
}
