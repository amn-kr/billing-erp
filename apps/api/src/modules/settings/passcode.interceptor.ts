/**
 * Enforces the transaction passcode on the server: an endpoint marked with @NeedsPasscode refuses
 * (403, code "passcode") when the shop's switch is on and the request has no correct passcode in
 * the x-txn-passcode header. Asked on every call, never remembered. A successful call is noted in
 * the audit log as done with the passcode.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PASSCODE_HEADER } from '@billing/shared';
import type { Request } from 'express';
import { from, mergeMap, switchMap, type Observable } from 'rxjs';
import type { RequestContext } from '../../common/context';
import { PasscodeService, type PasscodeUse } from './passcode.service';

const NEEDS_PASSCODE = 'needsPasscode';
interface Need { use: PasscodeUse; document: string }

/** Changing or cancelling a saved document: needs the transaction passcode when it is switched on. */
export const NeedsPasscode = (use: PasscodeUse, document: string) => SetMetadata(NEEDS_PASSCODE, { use, document } satisfies Need);

@Injectable()
export class PasscodeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly passcode: PasscodeService,
  ) {}

  intercept(ec: ExecutionContext, next: CallHandler): Observable<unknown> {
    const need = this.reflector.get<Need | undefined>(NEEDS_PASSCODE, ec.getHandler());
    if (!need) return next.handle();
    const req = ec.switchToHttp().getRequest<Request & { ctx: RequestContext }>();
    const ctx = req.ctx;
    const id = typeof req.params.id === 'string' ? req.params.id : undefined;
    const given = req.headers[PASSCODE_HEADER];
    let checked = false;
    return from((async () => {
      if (!(await this.passcode.required(ctx))) return;
      await this.passcode.check(ctx, typeof given === 'string' ? given : undefined, { use: need.use, entityId: id });
      checked = true;
    })()).pipe(
      switchMap(() => next.handle()),
      mergeMap(async (out) => {
        if (checked) await this.passcode.used(ctx, need.use, need.document, id).catch(() => undefined);
        return out;
      }),
    );
  }
}
