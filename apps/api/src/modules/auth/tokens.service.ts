import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokens } from '@billing/shared';
import { config } from '../../config';
import { DbService } from '../../common/db.service';
import type { AccessClaims } from '../../common/auth.guard';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface Issued extends AuthTokens {
  refreshToken: string;
  refreshExpires: Date;
  sessionId: string;
}

/**
 * Short-lived access tokens (JWT, 15 min) plus a long-lived refresh token
 * (random, stored hashed, rotated on every use). Re-using an old refresh
 * token signs that person out everywhere — it means the token was stolen.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  private async access(claims: AccessClaims): Promise<AuthTokens> {
    const minutes = config().ACCESS_TOKEN_MINUTES;
    return { accessToken: await this.jwt.signAsync(claims, { expiresIn: minutes * 60 }), expiresIn: minutes * 60 };
  }

  async start(user: { id: string; email: string }, businessId: string | null, meta: { ua: string; ip: string }): Promise<Issued> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpires = new Date(Date.now() + config().REFRESH_TOKEN_DAYS * 86_400_000);
    const s = await this.db.session.create({
      data: { userId: user.id, businessId, tokenHash: sha256(refreshToken), userAgent: meta.ua.slice(0, 300), ip: meta.ip, expiresAt: refreshExpires },
    });
    return { ...(await this.access({ sub: user.id, email: user.email, sid: s.id, bid: businessId })), refreshToken, refreshExpires, sessionId: s.id };
  }

  async rotate(refreshToken: string, meta: { ua: string; ip: string }): Promise<Issued> {
    const s = await this.db.session.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!s) throw new UnauthorizedException({ message: 'Please sign in.' });
    if (s.revokedAt) {
      if (s.replacedBy) await this.db.session.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException({ message: 'Please sign in again.' });
    }
    if (s.expiresAt < new Date()) throw new UnauthorizedException({ message: 'Your session has expired. Please sign in again.' });
    const next = await this.start(s.user, s.businessId, meta);
    await this.db.session.update({ where: { id: s.id }, data: { revokedAt: new Date(), replacedBy: next.sessionId } });
    return next;
  }

  /** New tokens for another shop on the same device (after creating, joining or switching). */
  async switchBusiness(sessionId: string, user: { id: string; email: string }, businessId: string, meta: { ua: string; ip: string }): Promise<Issued> {
    await this.revoke(sessionId);
    return this.start(user, businessId, meta);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeOthers(userId: string, keepSessionId: string): Promise<void> {
    await this.db.session.updateMany({ where: { userId, revokedAt: null, id: { not: keepSessionId } }, data: { revokedAt: new Date() } });
  }

  async revokeByToken(refreshToken: string): Promise<void> {
    await this.db.session.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
