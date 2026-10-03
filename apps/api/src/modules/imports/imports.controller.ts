import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { ImportsService } from './imports.service';

const importSchema = z.object({
  fileName: z.string().max(200).default('backup.json'),
  /** the backup file's contents, as text */
  backup: z.string().min(2, 'Choose a backup file.').max(25_000_000, 'This file is too big for a backup.'),
  includeSample: z.boolean().optional().default(false),
});

/** Settings › Import from the old app. Owner only (it replaces the shop's starting data). */
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** ?dryRun=true checks the file and reports what would be imported, without saving anything. */
  @RequirePermission('business.update')
  @HttpCode(200)
  @Post()
  run(@Ctx() ctx: RequestContext, @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>, @Query('dryRun') dryRun?: string) {
    return this.imports.run(
      { userId: ctx.userId, email: ctx.email, businessId: ctx.businessId!, ip: ctx.ip },
      { fileName: body.fileName, text: body.backup, includeSample: body.includeSample, dryRun: dryRun === 'true' },
    );
  }

  @RequirePermission('business.update')
  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.imports.list({ userId: ctx.userId, email: ctx.email, businessId: ctx.businessId! });
  }
}
