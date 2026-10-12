import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { BackupService } from './backup.service';

const destSchema = z.object({ dest: z.enum(['drive', 'local', 'both']).nullable() });
const fromSchema = z.object({ from: z.enum(['drive', 'local']) });
const restoreSchema = fromSchema.extend({
  confirm: z.literal(true, { errorMap: () => ({ message: 'Tick “I understand” to restore.' }) }),
});

/** Settings › General › Backup & restore (real-time backup). Choosing, restoring: the owner only. */
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  /** Everyone in the shop sees whether backups work (the red banner). */
  @RequirePermission('business.view')
  @Get('status')
  status(@Ctx() ctx: RequestContext) {
    return this.backup.status(ctx);
  }

  @RequirePermission('business.update')
  @Put('destination')
  async choose(@Ctx() ctx: RequestContext, @Body(new ZodPipe(destSchema)) body: z.infer<typeof destSchema>) {
    await this.backup.choose(ctx, body.dest);
    return this.backup.status(ctx);
  }

  @RequirePermission('business.update')
  @Post('now')
  @HttpCode(200)
  async now(@Ctx() ctx: RequestContext) {
    const results = await this.backup.now(ctx);
    return { results, status: await this.backup.status(ctx) };
  }

  @RequirePermission('business.update')
  @Post('test-restore')
  @HttpCode(200)
  testRestore(@Ctx() ctx: RequestContext, @Body(new ZodPipe(fromSchema)) body: z.infer<typeof fromSchema>) {
    return this.backup.testRestore(ctx, body.from);
  }

  @RequirePermission('business.update')
  @Post('restore')
  @HttpCode(200)
  restore(@Ctx() ctx: RequestContext, @Body(new ZodPipe(restoreSchema)) body: z.infer<typeof restoreSchema>) {
    return this.backup.restore(ctx, body.from);
  }
}
