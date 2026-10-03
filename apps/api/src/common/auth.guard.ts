import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Permission, RoleKey } from '@billing/shared';
import type { Request } from 'express';
import { DbService } from './db.service';
import { IS_PUBLIC, PERMISSION } from './decorators';
import type { RequestContext } from './context';

export interface AccessClaims {
  sub: string;
  email: string;
  sid: string;
  bid: string | null;
}

/**
 * Runs on every endpoint. Checks the access token, then loads the person's
 * role and permissions in the token's shop fresh from the database, so a
 * removed member or changed role takes effect on the next request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const targets = [ec.getHandler(), ec.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ec.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException({ message: 'Please sign in.' });
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token);
    } catch {
      throw new UnauthorizedException({ message: 'Your session has expired. Please sign in again.' });
    }

    let role: RoleKey | null = null;
    let permissions: Permission[] = [];
    if (claims.bid) {
      const m = await this.db.scoped({ businessId: claims.bid, userId: claims.sub, email: claims.email }, (tx) =>
        tx.membership.findFirst({
          where: { businessId: claims.bid!, userId: claims.sub, status: 'active' },
          include: { role: { include: { permissions: true } } },
        }),
      );
      if (!m) throw new ForbiddenException({ message: 'You no longer have access to that shop.', code: 'removed' });
      role = m.role.key as RoleKey;
      permissions = m.role.permissions.map((p) => p.permission as Permission);
    }

    req.ctx = {
      userId: claims.sub,
      email: claims.email,
      sessionId: claims.sid,
      businessId: claims.bid,
      role,
      permissions,
      ip: req.ip ?? '',
    };

    const need = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, targets);
    if (need) {
      if (!claims.bid) throw new ForbiddenException({ message: 'Set up or choose a shop first.' });
      if (!permissions.includes(need)) throw new ForbiddenException({ message: 'Your role does not allow this. Ask the shop owner.' });
    }
    return true;
  }
}
