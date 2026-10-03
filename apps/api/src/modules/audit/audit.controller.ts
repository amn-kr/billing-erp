import { Controller, Get, Query } from '@nestjs/common';
import { Ctx, RequirePermission } from '../../common/decorators';
import { DbService } from '../../common/db.service';
import type { RequestContext } from '../../common/context';

@Controller('audit')
export class AuditController {
  constructor(private readonly db: DbService) {}

  /** Latest audit entries for the current shop (newest first). */
  @RequirePermission('audit.view')
  @Get()
  list(@Ctx() ctx: RequestContext, @Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, (tx) =>
      tx.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take }),
    );
  }
}
