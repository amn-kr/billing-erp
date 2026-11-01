/**
 * The software owner's panel (/owner), kept in this folder so it can move to its own address later.
 * AppModule adds these; nothing else in the API imports from here except the shared sign-in (AuthService).
 */
import { OwnerAuditService } from './owner-audit.service';
import { OwnerAuthService } from './owner-auth.service';
import { OwnerController } from './owner.controller';
import { OwnerCustomersService } from './owner-customers.service';
import { OwnerGuard } from './owner.guard';
import { OwnerTokensService } from './owner-tokens.service';

export const OWNER_CONTROLLERS = [OwnerController];
export const OWNER_PROVIDERS = [OwnerAuditService, OwnerTokensService, OwnerAuthService, OwnerCustomersService, OwnerGuard];
export { OwnerAuthService } from './owner-auth.service';
export { OWNER_ROUTE } from './owner.guard';
export { clearOwnerCookie, setOwnerCookie } from './owner-cookies';
