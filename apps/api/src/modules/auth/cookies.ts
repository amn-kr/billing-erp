import type { Request, Response } from 'express';
import { config } from '../../config';
import type { Issued } from './tokens.service';

export const REFRESH_COOKIE = 'erp_rt';
const PATH = '/api/auth';

/** The refresh token lives only in an httpOnly cookie, out of reach of page scripts. */
export function setRefreshCookie(res: Response, t: Issued): void {
  res.cookie(REFRESH_COOKIE, t.refreshToken, {
    httpOnly: true,
    secure: !!config().COOKIE_SECURE,
    sameSite: 'lax',
    path: PATH,
    expires: t.refreshExpires,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: PATH });
}

export const readRefreshCookie = (req: Request): string => (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';

export const meta = (req: Request) => ({ ua: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' });
