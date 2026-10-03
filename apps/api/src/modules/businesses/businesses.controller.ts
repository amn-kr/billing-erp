import { BadRequestException, Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import { createBusinessSchema, firstError, switchBusinessSchema, type CreateBusinessInput } from '@billing/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { DbService } from '../../common/db.service';
import { TokensService } from '../auth/tokens.service';
import { meta, setRefreshCookie } from '../auth/cookies';
import { BusinessesService } from './businesses.service';

const user = (ctx: RequestContext) => ({ id: ctx.userId, email: ctx.email });

@Controller('businesses')
export class BusinessesController {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly tokens: TokensService,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** "Set up your shop". Returns tokens for the new shop. */
  @Post()
  async create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createBusinessSchema)) body: CreateBusinessInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const b = await this.businesses.create(ctx, body);
    const t = await this.tokens.switchBusiness(ctx.sessionId, user(ctx), b.id, meta(req));
    setRefreshCookie(res, t);
    return { business: { id: b.id, code: b.code, name: b.name }, accessToken: t.accessToken, expiresIn: t.expiresIn };
  }

  /** Org menu › choose another shop. */
  @Post('switch')
  async switch(@Ctx() ctx: RequestContext, @Body(new ZodPipe(switchBusinessSchema)) body: z.infer<typeof switchBusinessSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.businesses.assertMember(ctx, body.businessId);
    const t = await this.tokens.switchBusiness(ctx.sessionId, user(ctx), body.businessId, meta(req));
    await this.db.scoped({ businessId: body.businessId, userId: ctx.userId, email: ctx.email }, (tx) =>
      this.audit.log(tx, { businessId: body.businessId, userId: ctx.userId, action: 'switch_business', entity: 'business', entityId: body.businessId, ip: ctx.ip }),
    );
    setRefreshCookie(res, t);
    return { accessToken: t.accessToken, expiresIn: t.expiresIn };
  }

  @RequirePermission('business.view')
  @Get('current')
  current(@Ctx() ctx: RequestContext) {
    return this.businesses.current(ctx);
  }

  @RequirePermission('business.update')
  @Patch('current')
  update(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const partial = createBusinessSchema.innerType().partial().safeParse(body ?? {});
    if (!partial.success) throw new BadRequestException({ message: firstError(partial.error) });
    return this.businesses.update(ctx, partial.data);
  }
}
