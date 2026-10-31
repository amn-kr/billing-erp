import { Body, Controller, Get, Patch } from '@nestjs/common';
import { DENSITY_KEYS, TEXT_SIZE_KEYS, daysBetween, type Density, type MeBusiness, type MeResponse, type RoleKey, type TextSize } from '@billing/shared';
import { z } from 'zod';
import { Ctx, WithTempPassword } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { planToday } from '../../config';
import { DbService } from '../../common/db.service';
import type { RequestContext } from '../../common/context';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Settings › General › Display / the account menu: either choice or both */
const displaySchema = z
  .object({ density: z.enum(DENSITY_KEYS), textSize: z.enum(TEXT_SIZE_KEYS) })
  .partial()
  .strict()
  .refine((v) => v.density !== undefined || v.textSize !== undefined, 'Choose a density or a text size.');
const display = (u: { uiDensity: string; uiTextSize: string }) => ({ density: u.uiDensity as Density, textSize: u.uiTextSize as TextSize });

/** Everything the app shell needs after sign-in: who you are, your shop, your role, your other shops. */
@Controller('me')
export class MeController {
  constructor(private readonly db: DbService) {}

  @WithTempPassword()
  @Get()
  async me(@Ctx() ctx: RequestContext): Promise<MeResponse> {
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      const ms = await tx.membership.findMany({
        where: { userId: ctx.userId, status: 'active' },
        include: { business: true, role: true },
        orderBy: { createdAt: 'asc' },
      });
      const invites = await tx.invite.findMany({
        where: { email: ctx.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { business: true, role: true },
      });
      let business: MeBusiness | null = null;
      if (ctx.businessId) {
        const b = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId }, include: { settings: true } });
        const today = planToday();
        const ends = iso(b.planStatus === 'paid' && b.paidUntil ? b.paidUntil : b.trialEndsOn);
        const plan: MeBusiness['plan'] = daysBetween(today, ends) < 0 ? 'expired' : b.planStatus === 'paid' ? 'paid' : 'trial';
        business = {
          id: b.id, code: b.code, name: b.name, short: b.shortName, city: b.city, gstin: b.gstin, state: b.stateCode,
          gstEnabled: !!b.settings?.gstEnabled, plan, planEndsOn: ends,
        };
      }
      return {
        user: { id: u.id, name: u.name, email: u.email, mustChangePassword: u.mustChangePassword, ...display(u) },
        business,
        role: ctx.role,
        permissions: ctx.permissions,
        memberships: ms.map((m) => ({
          businessId: m.businessId, businessName: m.business.name, businessShort: m.business.shortName, businessCode: m.business.code,
          city: m.business.city, gstin: m.business.gstin, role: m.role.key as RoleKey,
        })),
        invites: invites
          .filter((i) => !ms.some((m) => m.businessId === i.businessId))
          .map((i) => ({ id: i.id, businessName: i.business.name, role: i.role.key as RoleKey })),
      };
    });
  }

  /** This person's own density and text size (any role; only their own row, in every shop they belong to). */
  @Patch('display')
  setDisplay(@Ctx() ctx: RequestContext, @Body(new ZodPipe(displaySchema)) body: z.infer<typeof displaySchema>) {
    return this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const u = await tx.user.update({ where: { id: ctx.userId }, data: { uiDensity: body.density, uiTextSize: body.textSize } });
      return display(u);
    });
  }
}
