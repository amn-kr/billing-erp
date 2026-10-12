import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface DbScope {
  businessId?: string | null;
  userId?: string | null;
  email?: string | null;
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
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.business_id', ${scope.businessId ?? ''}, true),
                                set_config('app.user_id', ${scope.userId ?? ''}, true),
                                set_config('app.user_email', ${scope.email ?? ''}, true)`;
      return fn(tx);
    }, { timeout: opts?.timeout ?? 15_000, maxWait: 10_000, ...(opts?.repeatable ? { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } : {}) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
