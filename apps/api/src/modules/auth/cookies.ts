import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { CLIENT_HEADER, REFRESH_HEADER } from '@billing/shared';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { config } from '../../config';
import type { Issued } from './tokens.service';

export const REFRESH_COOKIE = 'erp_rt';
const PATH = '/api/auth';

/**
 * The phone app (step 8.1c, owner 18 Nov 2026): it says so with `x-app-client: phone`. A browser
 * always sends an Origin (or Sec-Fetch-Site) with these calls, and such a call is never treated as
 * the phone, so a script in a web page can't ask for the long-lived token in the answer.
 */
export function isPhone(req: Request | undefined): boolean {
  if (!req) return false;
  return req.headers[CLIENT_HEADER] === 'phone' && !req.headers.origin && !req.headers['sec-fetch-site'];
}

interface Pending { refreshToken: string; refreshExpires: string }

/**
 * The refresh token lives only in an httpOnly cookie, out of reach of page scripts. For the phone
 * it goes in the answer instead (added by PhoneTokenInterceptor), to be kept in Android's safe store.
 */
export function setRefreshCookie(res: Response, t: Issued): void {
  if (isPhone(res.req)) {
    (res.locals as { phoneToken?: Pending }).phoneToken = { refreshToken: t.refreshToken, refreshExpires: t.refreshExpires.toISOString() };
    return;
  }
  res.cookie(REFRESH_COOKIE, t.refreshToken, {
    httpOnly: true,
    secure: !!config().COOKIE_SECURE,
    sameSite: 'lax',
    path: PATH,
    expires: t.refreshExpires,
  });
}

export function clearRefreshCookie(res: Response): void {
  if (isPhone(res.req)) return;
  res.clearCookie(REFRESH_COOKIE, { path: PATH });
}

/** The refresh token sent with this call: the phone's header, or the browser's cookie. */
export function readRefreshCookie(req: Request): string {
  if (isPhone(req)) {
    const h = req.headers[REFRESH_HEADER];
    return typeof h === 'string' ? h : '';
  }
  return (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
}

export const meta = (req: Request) => ({ ua: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' });

/** Adds the phone's new refresh token to the answer of any call that signed it in or renewed it. */
@Injectable()
export class PhoneTokenInterceptor implements NestInterceptor {
  intercept(ec: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ec.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((out) => {
        const t = (res.locals as { phoneToken?: Pending }).phoneToken;
        if (!t || !out || typeof out !== 'object' || Array.isArray(out)) return out;
        return { ...out, ...t };
      }),
    );
  }
}
