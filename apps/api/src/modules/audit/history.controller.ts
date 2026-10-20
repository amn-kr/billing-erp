import { Controller, Get, Param } from '@nestjs/common';
import { Ctx } from '../../common/decorators';
import type { RequestContext } from '../../common/context';
import { HistoryService } from './history.service';

@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  /**
   * "View history" of a saved or cancelled document: its edits, newest first. Only reads, so no
   * passcode. Whoever may open that kind of document may read it (checked in the service, per type).
   */
  @Get('history/:type/:id')
  read(@Ctx() ctx: RequestContext, @Param('type') type: string, @Param('id') id: string) {
    return this.history.read(ctx, type, id);
  }
}
