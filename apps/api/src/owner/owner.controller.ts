import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ownerSetupSchema, type OwnerCustomer, type OwnerCustomers, type OwnerMe, type OwnerSetupInput } from '@billing/shared';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { meta } from '../modules/auth/cookies';
import { OwnerAuthService } from './owner-auth.service';
import { clearOwnerCookie, readOwnerCookie, setOwnerCookie } from './owner-cookies';
import { OwnerCustomersService } from './owner-customers.service';
import { Owner, OwnerGuard, OwnerRoute, type OwnerContext } from './owner.guard';

/** The software owner's panel. Every route here takes only a panel token (OwnerGuard), never a shop token. */
@OwnerRoute()
@UseGuards(OwnerGuard)
@Controller('owner')
export class OwnerController {
  constructor(
    private readonly auth: OwnerAuthService,
    private readonly customers: OwnerCustomersService,
  ) {}

  /** Whether the one-time setup page can be used (server setting on, no owner account yet). */
  @Public()
  @Get('setup')
  async setupState(): Promise<{ open: boolean }> {
    return { open: await this.auth.setupOpen() };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('setup')
  async setup(@Body(new ZodPipe(ownerSetupSchema)) body: OwnerSetupInput, @Req() req: Request): Promise<void> {
    await this.auth.setup(body, req.ip ?? '');
  }

  @Public()
  @HttpCode(200)
  @Post('auth/refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rt = readOwnerCookie(req);
    if (!rt) throw new UnauthorizedException({ message: 'Please sign in.' });
    try {
      const t = await this.auth.refresh(rt, meta(req));
      setOwnerCookie(res, t);
      return { accessToken: t.accessToken, expiresIn: t.expiresIn };
    } catch (e) {
      clearOwnerCookie(res);
      throw e;
    }
  }

  @Public()
  @HttpCode(204)
  @Post('auth/logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const rt = readOwnerCookie(req);
    if (rt) await this.auth.signOut(rt, req.ip ?? '');
    clearOwnerCookie(res);
  }

  @Get('me')
  me(@Owner() o: OwnerContext): OwnerMe {
    return { name: o.name, email: o.email };
  }

  @Get('customers')
  list(@Owner() o: OwnerContext): Promise<OwnerCustomers> {
    return this.customers.list(o);
  }

  @HttpCode(200)
  @Post('customers/:id/suspend')
  suspend(@Owner() o: OwnerContext, @Param('id', ParseUUIDPipe) id: string): Promise<OwnerCustomer> {
    return this.customers.setStatus(o, id, 'suspended');
  }

  @HttpCode(200)
  @Post('customers/:id/reactivate')
  reactivate(@Owner() o: OwnerContext, @Param('id', ParseUUIDPipe) id: string): Promise<OwnerCustomer> {
    return this.customers.setStatus(o, id, 'active');
  }
}
