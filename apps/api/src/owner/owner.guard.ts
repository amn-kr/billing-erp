import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DbService } from '../common/db.service';
import { IS_PUBLIC } from '../common/decorators';
import { OwnerTokensService, type OwnerClaims } from './owner-tokens.service';

/** Who is using the panel. Built by OwnerGuard. */
export interface OwnerContext {
  adminId: string;
  email: string;
  name: string;
  sessionId: string;
  ip: string;
}

export const OWNER_ROUTE = 'ownerRoute';
/** A panel route: the shop's AuthGuard leaves it to OwnerGuard (which never accepts a shop token). */
export const OwnerRoute = () => SetMetadata(OWNER_ROUTE, true);

export const Owner = createParamDecorator((_: unknown, ec: ExecutionContext): OwnerContext => ec.switchToHttp().getRequest().owner);

/**
 * Runs on every panel route. Accepts only a panel token (signed with the panel's own key, typ "owner"),
 * and checks on every request that its sign-in is still open and the account still exists.
 */
@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: OwnerTokensService,
    private readonly db: DbService,
  ) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ec.getHandler(), ec.getClass()])) return true;
    const req = ec.switchToHttp().getRequest<Request & { owner?: OwnerContext }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException({ message: 'Please sign in.' });
    let claims: OwnerClaims;
    try {
      claims = await this.tokens.verify(token);
    } catch {
      throw new UnauthorizedException({ message: 'Your session has expired. Please sign in again.' });
    }
    if (claims.typ !== 'owner') throw new UnauthorizedException({ message: 'Please sign in.' });
    const s = await this.db.ownerSession.findUnique({ where: { id: claims.sid }, include: { admin: { select: { id: true, email: true, name: true } } } });
    if (!s || s.adminId !== claims.sub || (s.revokedAt && !s.replacedBy) || s.expiresAt < new Date()) {
      throw new UnauthorizedException({ message: 'Your session has expired. Please sign in again.' });
    }
    req.owner = { adminId: s.admin.id, email: s.admin.email, name: s.admin.name, sessionId: s.id, ip: req.ip ?? '' };
    return true;
  }
}
