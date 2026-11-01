import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config';
import { DbService } from '../common/db.service';
import { sha256 } from '../modules/auth/tokens.service';

/** A panel sign-in lasts at most this long, renewed or not; then the owner signs in again. */
export const OWNER_SESSION_HOURS = 12;

export interface OwnerClaims {
  sub: string;
  email: string;
  sid: string;
  typ: 'owner';
}

export interface OwnerIssued {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpires: Date;
  sessionId: string;
}

/**
 * Panel tokens are signed with their own key, made from JWT_SECRET for this purpose only: a shop token
 * can't open a panel route and a panel token can't open a shop route, because neither key checks the other's.
 */
let KEY: { from: string; key: string } | null = null;
export function ownerKey(): string {
  const secret = config().JWT_SECRET;
  if (KEY?.from !== secret) KEY = { from: secret, key: Buffer.from(hkdfSync('sha256', secret, 'billing-erp owner panel', 'access v1', 32)).toString('base64') };
  return KEY.key;
}

/** Like the shop's TokensService: short access tokens plus a refresh token stored hashed and rotated on every use. */
@Injectable()
export class OwnerTokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  private async issue(admin: { id: string; email: string }, sessionId: string, refreshToken: string, refreshExpires: Date): Promise<OwnerIssued> {
    const seconds = Math.max(1, Math.min(config().ACCESS_TOKEN_MINUTES * 60, Math.floor((refreshExpires.getTime() - Date.now()) / 1000)));
    const claims: OwnerClaims = { sub: admin.id, email: admin.email, sid: sessionId, typ: 'owner' };
    const accessToken = await this.jwt.signAsync(claims, { secret: ownerKey(), expiresIn: seconds });
    return { accessToken, expiresIn: seconds, refreshToken, refreshExpires, sessionId };
  }

  async start(admin: { id: string; email: string }, meta: { ua: string; ip: string }, expires?: Date): Promise<OwnerIssued> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpires = expires ?? new Date(Date.now() + OWNER_SESSION_HOURS * 3_600_000);
    const s = await this.db.ownerSession.create({
      data: { adminId: admin.id, tokenHash: sha256(refreshToken), userAgent: meta.ua.slice(0, 300), ip: meta.ip, expiresAt: refreshExpires },
    });
    return this.issue(admin, s.id, refreshToken, refreshExpires);
  }

  /** A new pair for the same sign-in; it still ends 12 hours after signing in. A re-used old token ends every panel sign-in. */
  async rotate(refreshToken: string, meta: { ua: string; ip: string }): Promise<OwnerIssued> {
    const s = await this.db.ownerSession.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { admin: true } });
    if (!s) throw new UnauthorizedException({ message: 'Please sign in.' });
    if (s.revokedAt) {
      if (s.replacedBy) await this.db.ownerSession.updateMany({ where: { adminId: s.adminId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException({ message: 'Please sign in again.' });
    }
    if (s.expiresAt < new Date()) throw new UnauthorizedException({ message: 'Your session has expired. Please sign in again.' });
    const next = await this.start(s.admin, meta, s.expiresAt);
    await this.db.ownerSession.update({ where: { id: s.id }, data: { revokedAt: new Date(), replacedBy: next.sessionId } });
    return next;
  }

  verify(token: string): Promise<OwnerClaims> {
    return this.jwt.verifyAsync<OwnerClaims>(token, { secret: ownerKey() });
  }

  async revokeByToken(refreshToken: string): Promise<string | null> {
    const s = await this.db.ownerSession.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!s) return null;
    await this.db.ownerSession.updateMany({ where: { id: s.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return s.adminId;
  }
}
