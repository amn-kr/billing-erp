/**
 * Transaction passcode (Settings › Transactions): when switched on, a saved document can only be
 * changed or cancelled with it. Same rules as the price PIN: a hash only, 5 wrong tries in a row
 * lock it for 60 seconds, and wrong tries are counted in their own transaction so the count
 * survives the refused request. The passcode and its hash are never logged or returned.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const TRIES = 5;
const WAIT_MS = 60_000;

/** What the passcode protects, for the audit log and the messages. */
export type PasscodeUse = 'edit' | 'cancel';

export interface PasscodeState {
  set: boolean;
  enabled: boolean;
}

/** The web opens the passcode box when an error carries this code. */
export const PASSCODE_CODE = 'passcode';

@Injectable()
export class PasscodeService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  private row(tx: Tx, ctx: RequestContext) {
    return tx.txnPasscode.findUnique({ where: { businessId: ctx.businessId! } });
  }

  state(ctx: RequestContext): Promise<PasscodeState> {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const r = await this.row(tx, ctx);
      return { set: !!r, enabled: !!r?.enabled };
    });
  }

  /** True when edit and cancel calls in this shop need the passcode. */
  async required(ctx: RequestContext): Promise<boolean> {
    return (await this.state(ctx)).enabled;
  }

  /**
   * Checks a passcode (or, for "Forgot passcode", the account password via `check`).
   * A wrong try is counted and written to the audit log; the fifth in a row locks for 60 seconds.
   */
  async check(ctx: RequestContext, given: string | undefined, why: { use: string; entityId?: string }, check?: (given: string) => Promise<boolean>): Promise<void> {
    if (!given) throw new ForbiddenException({ message: 'Enter the transaction passcode.', code: PASSCODE_CODE });
    const problem = await this.db.scoped(this.scope(ctx), async (tx) => {
      const r = await this.row(tx, ctx);
      if (!r) return 'Set a transaction passcode first.';
      const now = Date.now();
      if (r.waitUntil && r.waitUntil.getTime() > now) return `Too many wrong tries. Try again in ${Math.ceil((r.waitUntil.getTime() - now) / 1000)} seconds.`;
      if (await (check ? check(given) : verify(r.passcodeHash, given).catch(() => false))) {
        if (r.fails || r.waitUntil) await tx.txnPasscode.update({ where: { businessId: r.businessId }, data: { fails: 0, waitUntil: null } });
        return null;
      }
      const fails = r.fails + 1;
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'passcode_failed', entity: 'txn_passcode', entityId: why.entityId ?? null, after: { for: why.use }, ip: ctx.ip });
      if (fails >= TRIES) {
        await tx.txnPasscode.update({ where: { businessId: r.businessId }, data: { fails: 0, waitUntil: new Date(now + WAIT_MS) } });
        return 'Too many wrong tries. Try again in 60 seconds.';
      }
      await tx.txnPasscode.update({ where: { businessId: r.businessId }, data: { fails } });
      const left = TRIES - fails;
      return `${check ? 'Wrong password' : 'Wrong passcode'}. ${left} tr${left > 1 ? 'ies' : 'y'} left.`;
    });
    if (problem) throw new ForbiddenException({ message: problem, code: PASSCODE_CODE });
  }

  /** Writes "done with the passcode" next to a successful edit or cancel. */
  used(ctx: RequestContext, use: PasscodeUse, document: string, entityId: string | undefined) {
    return this.db.scoped(this.scope(ctx), (tx) =>
      this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'passcode_used', entity: 'txn_passcode', entityId: entityId ?? null, after: { for: use, document }, ip: ctx.ip }),
    );
  }

  /** Turns the switch on. The first time, a new passcode is needed; after that the saved one is used again. */
  async turnOn(ctx: RequestContext, passcode?: string): Promise<PasscodeState> {
    const s = await this.state(ctx);
    if (!s.set && !passcode) throw new BadRequestException({ message: 'Choose a 4 to 6 digit passcode.', field: 'passcode' });
    const passcodeHash = !s.set ? await hash(passcode!, ARGON) : null;
    return this.db.scoped(this.scope(ctx), async (tx) => {
      if (passcodeHash) {
        await tx.txnPasscode.create({ data: { businessId: ctx.businessId!, createdBy: ctx.userId, passcodeHash, enabled: true } });
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'txn_passcode', after: { enabled: true }, ip: ctx.ip });
      } else if (!s.enabled) {
        await tx.txnPasscode.update({ where: { businessId: ctx.businessId! }, data: { enabled: true } });
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'txn_passcode', before: { enabled: false }, after: { enabled: true }, ip: ctx.ip });
      }
      return { set: true, enabled: true };
    });
  }

  /** Turns the switch off; needs the passcode. The passcode is kept for when it's turned on again. */
  async turnOff(ctx: RequestContext, passcode: string): Promise<PasscodeState> {
    const s = await this.state(ctx);
    if (!s.enabled) return s;
    await this.check(ctx, passcode, { use: 'turn_off' });
    return this.db.scoped(this.scope(ctx), async (tx) => {
      await tx.txnPasscode.update({ where: { businessId: ctx.businessId! }, data: { enabled: false } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'txn_passcode', before: { enabled: true }, after: { enabled: false }, ip: ctx.ip });
      return { set: true, enabled: false };
    });
  }

  /** Change Passcode: the current passcode first. */
  async change(ctx: RequestContext, current: string, next: string): Promise<PasscodeState> {
    await this.check(ctx, current, { use: 'change' });
    return this.replace(ctx, next, 'changed');
  }

  /** Forgot passcode: only the shop owner, with their own account password. Wrong passwords count as wrong tries. */
  async reset(ctx: RequestContext, password: string, next: string): Promise<PasscodeState> {
    if (ctx.role !== 'owner') throw new ForbiddenException({ message: 'Only the shop owner can set a new passcode this way.' });
    const user = await this.db.user.findUnique({ where: { id: ctx.userId }, select: { passwordHash: true } });
    await this.check(ctx, password, { use: 'forgot' }, async (pw) => !!user && (await verify(user.passwordHash, pw).catch(() => false)));
    return this.replace(ctx, next, 'reset with account password');
  }

  private async replace(ctx: RequestContext, next: string, how: string): Promise<PasscodeState> {
    const passcodeHash = await hash(next, ARGON);
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const r = await tx.txnPasscode.update({ where: { businessId: ctx.businessId! }, data: { passcodeHash, fails: 0, waitUntil: null } });
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'txn_passcode', after: { passcode: how }, ip: ctx.ip });
      return { set: true, enabled: r.enabled };
    });
  }
}
