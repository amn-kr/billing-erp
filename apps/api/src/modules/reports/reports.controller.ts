import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Ctx, RequirePermission } from '../../common/decorators';
import type { RequestContext } from '../../common/context';
import { ReportsService } from './reports.service';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** A period as ISO dates; an open end runs from 2000 or to 2099 (the prototype's "All time"). */
function period(from?: string, to?: string): [string, string] {
  const f = from || '2000-01-01', t = to || '2099-12-31';
  if (!ISO.test(f) || !ISO.test(t)) throw new BadRequestException('Dates must be like 2026-04-01.');
  return [f, t];
}

/** The rebuilt reports (prototype RPT.*). */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Home tiles: everyone who can see sales sees Home, as in the prototype. */
  @RequirePermission('sales.view')
  @Get('home')
  home(@Ctx() ctx: RequestContext, @Query('today') today?: string) {
    // the screen's own date (the shop's day in India), so "today" matches what the person sees
    if (today && !ISO.test(today)) throw new BadRequestException('Dates must be like 2026-04-01.');
    return this.reports.home(ctx, today || undefined);
  }

  @RequirePermission('reports.view')
  @Get('parties')
  parties(@Ctx() ctx: RequestContext) {
    return this.reports.partyList(ctx);
  }

  @RequirePermission('reports.view')
  @Get('all-parties')
  allParties(@Ctx() ctx: RequestContext) {
    return this.reports.allParties(ctx);
  }

  @RequirePermission('reports.view')
  @Get('party-activity')
  activity(@Ctx() ctx: RequestContext, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.activity(ctx, ...period(from, to));
  }

  /** The Parties page's transaction list for one party (rows filtered by the person's sales / purchases access). */
  @RequirePermission('masters.view')
  @Get('party-tx/:id')
  partyTx(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.partyTx(ctx, id);
  }

  @RequirePermission('reports.view')
  @Get('statement/:id')
  statement(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.statement(ctx, id, ...period(from, to));
  }

  @RequirePermission('reports.view')
  @Get('party-items/:id')
  partyItems(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.partyItems(ctx, id, ...period(from, to));
  }
}
