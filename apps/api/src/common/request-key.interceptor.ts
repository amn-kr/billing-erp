/**
 * One-time keys against double bills (owner, 18 Nov 2026; step 8.1b). A save that carries an
 * `Idempotency-Key` header is done once: the same key sent again (weak internet, the phone's
 * offline queue) gets the first answer back instead of a second bill.
 *
 * - The key is noted before the save runs, so two copies arriving together can't both save:
 *   the second is told to wait ("still being saved").
 * - A save that fails forgets its key, so it can be sent again (also with changes, such as
 *   "save anyway" after the credit limit question).
 * - The same key with a different save, or from another person, is refused.
 * - Keys are kept 7 days. A key left half-way for over 2 minutes (the server stopped during the
 *   save) is given up and the save runs again.
 * Saves without the header work as before (the web app today).
 */
import { BadRequestException, ConflictException, Injectable, UnprocessableEntityException, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { REQUEST_KEY_HEADER } from '@billing/shared';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { catchError, from, mergeMap, of, switchMap, type Observable } from 'rxjs';
import type { RequestContext } from './context';
import { DbService } from './db.service';

const KEEP_MS = 7 * 24 * 3600_000;
const STUCK_MS = 2 * 60_000;
const KEY_OK = /^[A-Za-z0-9_-]{8,100}$/;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class RequestKeyInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(ec: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ec.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
    const key = req.headers[REQUEST_KEY_HEADER];
    const ctx = req.ctx;
    if (typeof key !== 'string' || !WRITES.has(req.method) || !ctx?.businessId) return next.handle();
    if (!KEY_OK.test(key)) throw new BadRequestException({ message: 'The one-time key is not valid.', code: 'request_key' });
    const scope = { businessId: ctx.businessId, userId: ctx.userId };
    const fingerprint = createHash('sha256').update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`).digest('hex');

    return from(this.claim(scope, key, ctx.userId, fingerprint)).pipe(
      switchMap((done) => {
        if (done) return of(done.response ?? undefined);
        return next.handle().pipe(
          mergeMap(async (out) => {
            await this.db.scoped(scope, (tx) => tx.requestKey.update({ where: { businessId_key: { businessId: scope.businessId, key } }, data: { status: 200, response: out === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(out)) as Prisma.InputJsonValue) } })).catch(() => undefined);
            return out;
          }),
          catchError(async (e: unknown) => {
            await this.db.scoped(scope, (tx) => tx.requestKey.deleteMany({ where: { key, status: null } })).catch(() => undefined);
            throw e;
          }),
        );
      }),
    );
  }

  /** Notes the key; returns the earlier answer when this save was already done. */
  private claim(scope: { businessId: string; userId: string }, key: string, userId: string, fingerprint: string) {
    return this.db.scoped(scope, async (tx) => {
      await tx.requestKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } });
      const added = await tx.$executeRaw`INSERT INTO request_keys (business_id, key, user_id, fingerprint) VALUES (${scope.businessId}::uuid, ${key}, ${userId}::uuid, ${fingerprint}) ON CONFLICT DO NOTHING`;
      if (added === 1) return null;
      const row = await tx.requestKey.findUniqueOrThrow({ where: { businessId_key: { businessId: scope.businessId, key } } });
      if (row.userId !== userId || row.fingerprint !== fingerprint)
        throw new UnprocessableEntityException({ message: 'This one-time key was already used for a different save.', code: 'request_key_reused' });
      if (row.status !== null) return row;
      if (Date.now() - row.createdAt.getTime() < STUCK_MS)
        throw new ConflictException({ message: 'This is still being saved. Wait a moment.', code: 'request_in_progress' });
      await tx.requestKey.update({ where: { businessId_key: { businessId: scope.businessId, key } }, data: { createdAt: new Date() } });
      return null;
    });
  }
}
