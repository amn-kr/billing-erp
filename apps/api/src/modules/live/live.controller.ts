import { BadRequestException, Controller, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { Ctx } from '../../common/decorators';
import type { RequestContext } from '../../common/context';
import { newsFor } from '../../common/live';

/**
 * GET /api/live — one long-lived connection per open app, carrying the shop's live news
 * (server-sent events). Any signed-in member of the shop may listen; nothing private is sent,
 * only "the next number of this document type changed".
 */
@Controller('live')
export class LiveController {
  @Sse()
  stream(@Ctx() ctx: RequestContext): Observable<{ type: string; data: Record<string, string> }> {
    if (!ctx.businessId) throw new BadRequestException({ message: 'Set up or choose a shop first.' });
    return newsFor(ctx.businessId);
  }
}
