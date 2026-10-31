import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { acceptInviteSchema, changeRoleSchema, inviteSchema, type InviteInput } from '@billing/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { TokensService } from '../auth/tokens.service';
import { meta, setRefreshCookie } from '../auth/cookies';
import { MembersService } from './members.service';

@Controller()
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly tokens: TokensService,
  ) {}

  @RequirePermission('members.view')
  @Get('members')
  list(@Ctx() ctx: RequestContext) {
    return this.members.list(ctx);
  }

  @RequirePermission('members.manage')
  @Post('members/invites')
  invite(@Ctx() ctx: RequestContext, @Body(new ZodPipe(inviteSchema)) body: InviteInput) {
    return this.members.invite(ctx, body);
  }

  @RequirePermission('members.manage')
  @HttpCode(204)
  @Post('members/invites/:id/revoke')
  revoke(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.revokeInvite(ctx, id);
  }

  @RequirePermission('members.manage')
  @HttpCode(204)
  @Patch('members/:id/role')
  changeRole(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(changeRoleSchema)) body: z.infer<typeof changeRoleSchema>) {
    return this.members.changeRole(ctx, id, body.role);
  }

  @RequirePermission('members.manage')
  @HttpCode(204)
  @Post('members/:id/remove')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.remove(ctx, id);
  }

  /** Owner only (checked in the service): a temporary password, shown once. */
  @RequirePermission('members.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('members/:id/reset-password')
  resetPassword(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.resetPassword(ctx, id);
  }

  @RequirePermission('members.view')
  @Get('roles')
  roles(@Ctx() ctx: RequestContext) {
    return this.members.roles(ctx);
  }

  /** "Join <shop>": any signed-in person with an invite to their email. Returns tokens for that shop. */
  @HttpCode(200)
  @Post('invites/:id/accept')
  async accept(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(acceptInviteSchema)) body: z.infer<typeof acceptInviteSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const businessId = await this.members.accept(ctx, id, body.name);
    const t = await this.tokens.switchBusiness(ctx.sessionId, { id: ctx.userId, email: ctx.email }, businessId, meta(req));
    setRefreshCookie(res, t);
    return { businessId, accessToken: t.accessToken, expiresIn: t.expiresIn };
  }
}
