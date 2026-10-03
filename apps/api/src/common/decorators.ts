import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@billing/shared';
import type { RequestContext } from './context';

export const IS_PUBLIC = 'isPublic';
/** No sign-in needed (sign-in, sign-up, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const NEEDS_BUSINESS = 'needsBusiness';
export const PERMISSION = 'permission';
/** Needs a current shop and this permission in it. */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION, p);

export const Ctx = createParamDecorator((_: unknown, ec: ExecutionContext): RequestContext => ec.switchToHttp().getRequest().ctx);
