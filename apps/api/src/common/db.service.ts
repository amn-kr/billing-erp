import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface DbScope {
  businessId?: string | null;
  userId?: string | null;
  email?: string | null;
}

/** Work waiting for a transaction to commit, per open transaction (see `afterCommit`). */
const AFTER = new WeakMap<object, (() => void)[]>();

/**
 * Runs `fn` once the transaction `tx` has committed, never if it rolls back (used to tell open
 * screens about a new document number only when that document really exists). Outside
 * `DbService.scoped` (scripts, tests) it runs straight away.
 */
export function afterCommit(tx: Tx, fn: () => void): void {
  const waiting = AFTER.get(tx);
  if (waiting) waiting.push(fn);
  else fn();
}

/**
 * The only way the API touches shop data: every query runs inside a
 * transaction that first sets the row-level-security context, so Postgres
 * itself refuses rows from other shops even if our code has a bug.
 */
@Injectable()
export class DbService extends PrismaClient implements OnModuleDestroy {
  /** `repeatable`: every read sees the books as of one moment (a backup's full copy). */
  async scoped<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number; repeatable?: boolean }): Promise<T> {
    const waiting: (() => void)[] = [];
    const out = await this.$transaction(async (tx) => {
      AFTER.set(tx, waiting);
      await tx.$queryRaw`SELECT set_config('app.business_id', ${scope.businessId ?? ''}, true),
                                set_config('app.user_id', ${scope.userId ?? ''}, true),
                                set_config('app.user_email', ${scope.email ?? ''}, true)`;
      return fn(tx);
    }, { timeout: opts?.timeout ?? 15_000, maxWait: 10_000, ...(opts?.repeatable ? { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } : {}) });
    // committed: what was waiting runs now; a problem there never undoes or fails the saved work
    for (const fn2 of waiting) {
      try {
        fn2();
      } catch {
        /* ignored on purpose */
      }
    }
    return out;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
