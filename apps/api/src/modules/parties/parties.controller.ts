import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { nameSchema, partySchema, partyUpdateSchema, type PartyInput } from '@billing/shared';
import type { z } from 'zod';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { PartiesService } from './parties.service';

@Controller()
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @RequirePermission('masters.view')
  @Get('parties')
  list(@Ctx() ctx: RequestContext, @Query('q') q?: string, @Query('kind') kind?: string, @Query('group') group?: string, @Query('archived') archived?: string) {
    return this.parties.list(ctx, { search: q, kind, group, archived: archived === 'true' });
  }

  @RequirePermission('masters.view')
  @Get('parties/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.parties.get(ctx, id);
  }

  @RequirePermission('masters.manage')
  @Post('parties')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(partySchema)) body: PartyInput) {
    return this.parties.create(ctx, body);
  }

  @RequirePermission('masters.manage')
  @Patch('parties/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(partyUpdateSchema)) body: Partial<PartyInput>) {
    return this.parties.update(ctx, id, body);
  }

  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('parties/:id/archive')
  archive(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.parties.setArchived(ctx, id, true);
  }

  @RequirePermission('masters.manage')
  @HttpCode(200)
  @Post('parties/:id/restore')
  restore(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.parties.setArchived(ctx, id, false);
  }

  @RequirePermission('masters.view')
  @Get('party-groups')
  groups(@Ctx() ctx: RequestContext) {
    return this.parties.groups(ctx);
  }

  @RequirePermission('masters.manage')
  @Post('party-groups')
  addGroup(@Ctx() ctx: RequestContext, @Body(new ZodPipe(nameSchema)) body: z.infer<typeof nameSchema>) {
    return this.parties.addGroup(ctx, body.name);
  }
}
