import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { changePasswordSchema, loginSchema, makeRecoveryCodesSchema, recoverSchema, registerSchema, type AuthTokens, type ChangePasswordInput, type OwnerSignIn, type LoginInput, type MakeRecoveryCodesInput, type RecoverInput, type RegisterInput } from '@billing/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Ctx, Public, WithTempPassword } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { AuthService } from './auth.service';
import { TokensService, type Issued } from './tokens.service';
import { clearRefreshCookie, meta, readRefreshCookie, setRefreshCookie } from './cookies';
import { clearOwnerCookie, setOwnerCookie } from '../../owner';

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email('That email doesn’t look right.') });
const resetSchema = z.object({ token: z.string().min(10), password: registerSchema.shape.password });

const reply = (res: Response, t: Issued): AuthTokens => {
  setRefreshCookie(res, t);
  return { accessToken: t.accessToken, expiresIn: t.expiresIn };
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return reply(res, await this.auth.register(body, meta(req)));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.login(body, meta(req));
    // a browser holds one sign-in at a time: the panel's or a shop's
    if ('owner' in t) {
      clearRefreshCookie(res);
      setOwnerCookie(res, t);
      return { accessToken: t.accessToken, expiresIn: t.expiresIn, owner: true } satisfies OwnerSignIn;
    }
    clearOwnerCookie(res);
    return reply(res, t);
  }

  @Public()
  @HttpCode(200)
  @Post('demo')
  async demo(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return reply(res, await this.auth.demo(meta(req)));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rt = readRefreshCookie(req);
    if (!rt) throw new UnauthorizedException({ message: 'Please sign in.' });
    try {
      return reply(res, await this.tokens.rotate(rt, meta(req)));
    } catch (e) {
      clearRefreshCookie(res);
      throw e;
    }
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rt = readRefreshCookie(req);
    if (rt) await this.tokens.revokeByToken(rt);
    clearRefreshCookie(res);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('forgot')
  async forgot(@Body(new ZodPipe(forgotSchema)) body: z.infer<typeof forgotSchema>) {
    await this.auth.forgot(body.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('reset')
  async reset(@Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>) {
    await this.auth.reset(body.token, body.password);
  }

  /** "Choose a new password": the current (temporary) password, then a new one. */
  @WithTempPassword()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('change-password')
  async changePassword(@Ctx() ctx: RequestContext, @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput) {
    await this.auth.changePassword(ctx, body);
  }

  /** Recovery codes card: how many unused codes are left (never the codes). */
  @Get('recovery-codes')
  recoveryState(@Ctx() ctx: RequestContext) {
    return this.auth.recoveryState(ctx);
  }

  /** Ten new recovery codes for the person's own account, after their password; shown once. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('recovery-codes')
  makeRecoveryCodes(@Ctx() ctx: RequestContext, @Body(new ZodPipe(makeRecoveryCodesSchema)) body: MakeRecoveryCodesInput) {
    return this.auth.makeRecoveryCodes(ctx, body);
  }

  /** "Use a recovery code" on the sign-in page: email, code and a new password; signs the person in. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('recover')
  async recover(@Body(new ZodPipe(recoverSchema)) body: RecoverInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return reply(res, await this.auth.recover(body, meta(req)));
  }

  /** Sign out every other device. */
  @HttpCode(204)
  @Post('logout-others')
  async logoutOthers(@Ctx() ctx: RequestContext) {
    await this.tokens.revokeOthers(ctx.userId, ctx.sessionId);
  }
}
