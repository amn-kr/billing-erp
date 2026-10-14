import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { passcodeSchema } from '@billing/shared';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { PasscodeService } from './passcode.service';

const onSchema = z.object({ passcode: passcodeSchema.optional() });
const offSchema = z.object({ passcode: passcodeSchema });
const changeSchema = z.object({ current: passcodeSchema, passcode: passcodeSchema });
const resetSchema = z.object({ password: z.string().min(1, 'Enter your account password.').max(200), passcode: passcodeSchema });

/** Settings › Transactions › Enable Passcode for transaction edit/delete. Never returns the passcode or its hash. */
@Controller('settings/passcode')
export class PasscodeController {
  constructor(private readonly passcode: PasscodeService) {}

  /** Every member needs to know whether to ask for it before saving a change. */
  @RequirePermission('business.view')
  @Get()
  state(@Ctx() ctx: RequestContext) {
    return this.passcode.state(ctx);
  }

  @RequirePermission('settings.manage')
  @HttpCode(200)
  @Post('on')
  on(@Ctx() ctx: RequestContext, @Body(new ZodPipe(onSchema)) body: z.infer<typeof onSchema>) {
    return this.passcode.turnOn(ctx, body.passcode);
  }

  @RequirePermission('settings.manage')
  @HttpCode(200)
  @Post('off')
  off(@Ctx() ctx: RequestContext, @Body(new ZodPipe(offSchema)) body: z.infer<typeof offSchema>) {
    return this.passcode.turnOff(ctx, body.passcode);
  }

  /** Change Passcode, step 1: is this the current passcode? (wrong tries count like everywhere else) */
  @RequirePermission('settings.manage')
  @HttpCode(204)
  @Post('check')
  check(@Ctx() ctx: RequestContext, @Body(new ZodPipe(offSchema)) body: z.infer<typeof offSchema>) {
    return this.passcode.check(ctx, body.passcode, { use: 'change' });
  }

  @RequirePermission('settings.manage')
  @HttpCode(200)
  @Post('change')
  change(@Ctx() ctx: RequestContext, @Body(new ZodPipe(changeSchema)) body: z.infer<typeof changeSchema>) {
    return this.passcode.change(ctx, body.current, body.passcode);
  }

  /** Forgot passcode: the owner's account password instead of the old passcode. */
  @RequirePermission('settings.manage')
  @HttpCode(200)
  @Post('reset')
  reset(@Ctx() ctx: RequestContext, @Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>) {
    return this.passcode.reset(ctx, body.password, body.passcode);
  }
}
