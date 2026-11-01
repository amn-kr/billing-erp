import type { Request, Response } from 'express';
import { config } from '../config';
import type { OwnerIssued } from './owner-tokens.service';

/** The panel's own refresh cookie: another name and path than the shop's (erp_rt on /api/auth). */
export const OWNER_COOKIE = 'erp_ort';
const PATH = '/api/owner/auth';

export function setOwnerCookie(res: Response, t: OwnerIssued): void {
  res.cookie(OWNER_COOKIE, t.refreshToken, { httpOnly: true, secure: !!config().COOKIE_SECURE, sameSite: 'lax', path: PATH, expires: t.refreshExpires });
}

export function clearOwnerCookie(res: Response): void {
  res.clearCookie(OWNER_COOKIE, { path: PATH });
}

export const readOwnerCookie = (req: Request): string => (req.cookies?.[OWNER_COOKIE] as string | undefined) ?? '';
