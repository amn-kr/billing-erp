/**
 * Move to cloud (Phase 6, step 7): a shop that started on one PC (the Windows app's single-PC mode)
 * puts its whole books into the online app once, and then works online.
 *
 *  - On the PC (POST /api/cloud/move, single-PC mode only): signs in to the online app with the owner's
 *    online account (or makes one), packs the books as they are now (the same full copy the backups
 *    use), sends them, and compares the counts on both sides.
 *  - Online (POST /api/cloud/import, any signed-in person): the books become a new shop owned by that
 *    person, exactly as a restore makes new books (new ids, the person as owner, a new free trial). The
 *    same PC books sent twice by the same person give the same shop once, never two copies.
 *
 * Bring my online books to this PC (Phase 6, step 7b), the other way:
 *  - On the PC's sign-in page (POST /api/cloud/bring/shops and /api/cloud/bring, single-PC mode only): the
 *    owner signs in with their online account; the PC's server lists the shops that account owns, takes the
 *    chosen one's whole books down, makes them books on this PC with the owner's account (same email and
 *    password), compares the counts, and only then asks the online app to make that shop view-only.
 *  - Online (GET /api/cloud/shops, POST /api/cloud/export, POST /api/cloud/moved-to-pc): the owner's shops,
 *    the whole books of one, and the view-only mark (the request guard then refuses every change).
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Post, Req, Res } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { financialYearOf, todayIst } from '@billing/shared';
import { config } from '../../config';
import { AuditService } from '../../common/audit.service';
import { DbService } from '../../common/db.service';
import { Ctx, Public, RequirePermission } from '../../common/decorators';
import { movedToPcMessage } from '../../common/auth.guard';
import { meta, setRefreshCookie } from '../auth/cookies';
import { hashPassword } from '../auth/password';
import { TokensService } from '../auth/tokens.service';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { BackupService } from './backup.service';
import { replay, summarise, type SnapshotBody } from './restore';
import type { TableInfo } from './tables';

/** The same PC books moved by the same person always get the same new id (a retry finds the shop made the first time). */
export function movedId(sourceId: string, userId: string): string {
  const h = createHash('sha256').update(`billing-erp move to cloud\0${sourceId}\0${userId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** An online shop brought down to a PC always gets the same id there (a retry finds the books made the first time). */
export function pcId(onlineId: string): string {
  return movedId(onlineId, 'bring to this PC');
}

/** Columns the PC has that the online app doesn't know yet: the online app must be updated first. */
export function unknownColumns(pc: Record<string, string[]>, online: TableInfo[]): string[] {
  const have = new Map(online.map((t) => [t.name, new Set(t.columns)]));
  const out: string[] = [];
  for (const [t, cols] of Object.entries(pc)) {
    const h = have.get(t);
    for (const c of cols) if (!h?.has(c)) out.push(`${t}.${c}`);
  }
  return out;
}

const counts = (books: ReturnType<typeof replay>['books']) => summarise(books, financialYearOf(todayIst()));
export type Counts = ReturnType<typeof counts>;

const importSchema = z.object({
  source: z.object({ id: z.string().uuid(), code: z.string().max(40), name: z.string().max(200) }),
  columns: z.record(z.array(z.string())),
  /** the full copy (SnapshotBody), gzipped JSON, base64 */
  data: z.string().min(1),
});
const bringLogin = z.object({
  email: z.string().trim().toLowerCase().email('That email doesn’t look right.').max(200),
  password: z.string().min(1, 'Enter the password of your online account.').max(200),
});
const bringSchema = bringLogin.extend({
  businessId: z.string().uuid('Choose the shop to bring to this PC.'),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Tick “I understand” to bring the books to this PC.' }) }),
});
const shopOnly = z.object({ businessId: z.string().uuid() });

/** One of the online account's shops, as the PC's sign-in page lists them. */
export interface OwnedShop { id: string; code: string; name: string; city: string; movedToPcOn: string | null }

const moveSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  /** make a new online account with this email and password (otherwise: sign in to an existing one) */
  create: z.boolean().default(false),
  name: z.string().max(100).default(''),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Tick “I understand” to move the books.' }) }),
});

@Injectable()
export class CloudService {
  constructor(
    private readonly backup: BackupService,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Online: the PC's books become a shop of this person (once). */
  async import(ctx: RequestContext, body: z.infer<typeof importSchema>) {
    const tables = await this.backup.tablesFor({ ...ctx, businessId: null } as RequestContext);
    const unknown = unknownColumns(body.columns, tables);
    if (unknown.length) throw new ConflictException({ message: 'The online app needs an update before these books can be moved. Please try again tomorrow, or contact support.', unknown: unknown.slice(0, 20) });
    let snap: SnapshotBody;
    try { snap = JSON.parse(gunzipSync(Buffer.from(body.data, 'base64')).toString('utf8')) as SnapshotBody; } catch { throw new BadRequestException({ message: 'The books arrived damaged. Please try again.' }); }
    if (!snap?.tables?.businesses?.length) throw new BadRequestException({ message: 'The books arrived without the shop’s details. Please try again.' });
    const b = replay(tables, snap, 0n, []);
    const newId = movedId(body.source.id, ctx.userId);
    const had = await this.db.scoped({ businessId: newId, userId: ctx.userId, email: ctx.email }, (tx) => tx.business.findUnique({ where: { id: newId }, select: { code: true, name: true } }));
    if (had) return { businessId: newId, code: had.code, name: had.name, already: true, counts: counts(b.books) };
    const made = await this.backup.restoreInto(ctx, { tables, books: b.books, lastAt: null }, 'move to cloud', new Date(), body.source.id, newId);
    return { ...made, already: false, counts: counts(b.books) };
  }

  /** Online: the shops this person owns (staff places are not offered: only the owner can take books away). */
  async ownedShops(ctx: RequestContext): Promise<OwnedShop[]> {
    const ms = await this.db.scoped({ userId: ctx.userId, email: ctx.email }, (tx) =>
      tx.membership.findMany({ where: { userId: ctx.userId, status: 'active' }, orderBy: { createdAt: 'asc' }, select: { business: { select: { id: true, code: true, name: true, city: true, ownerId: true, status: true, movedToPcAt: true } } } }),
    );
    return ms
      .map((m) => m.business)
      .filter((b) => b.ownerId === ctx.userId && b.status !== 'suspended')
      .map((b) => ({ id: b.id, code: b.code, name: b.name, city: b.city, movedToPcOn: b.movedToPcAt?.toISOString() ?? null }));
  }

  /** Online: one shop of its owner, checked (owner, not suspended, not moved to a PC already). */
  private async ownShop(ctx: RequestContext, businessId: string) {
    const b = await this.db.scoped({ businessId, userId: ctx.userId, email: ctx.email }, (tx) =>
      tx.business.findUnique({ where: { id: businessId }, select: { id: true, code: true, name: true, ownerId: true, status: true, movedToPcAt: true } }),
    );
    if (!b || b.ownerId !== ctx.userId) throw new ForbiddenException({ message: 'Only the shop’s owner can bring its books to a PC.' });
    if (b.status === 'suspended') throw new ForbiddenException({ message: 'This shop’s account is paused. Please contact support.' });
    return b;
  }

  /** Online: the whole books of one of this person's shops, as they are now (the same full copy the backups make). */
  async export(ctx: RequestContext, businessId: string) {
    const b = await this.ownShop(ctx, businessId);
    if (b.movedToPcAt) throw new ConflictException({ message: `${movedToPcMessage(b.movedToPcAt).split('.')[0]}.`, code: 'moved_to_pc' });
    const shopCtx = { ...ctx, businessId } as RequestContext;
    const tables = await this.backup.tablesFor(shopCtx);
    const { body: snap } = await this.backup.buildSnapshot(businessId);
    return {
      source: { id: b.id, code: b.code, name: b.name },
      columns: Object.fromEntries(tables.map((t) => [t.name, t.columns])),
      data: gzipSync(Buffer.from(JSON.stringify(snap))).toString('base64'),
      counts: counts(replay(tables, snap, 0n, []).books),
    };
  }

  /** Online: the books are on a PC now; from here on the shop can be looked at and printed, not changed. */
  async markMoved(ctx: RequestContext, businessId: string, pc: { code: string }) {
    const b = await this.ownShop(ctx, businessId);
    const at = b.movedToPcAt ?? new Date();
    if (!b.movedToPcAt) {
      await this.db.scoped({ businessId, userId: ctx.userId, email: ctx.email }, async (tx) => {
        await tx.business.update({ where: { id: businessId }, data: { movedToPcAt: at } });
        await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'move_to_pc', entity: 'business', entityId: businessId, after: { pcBooks: pc.code, viewOnlyFrom: at.toISOString() }, ip: ctx.ip });
      });
    }
    return { movedToPcOn: at.toISOString() };
  }
}

/** Calls to the online app, with its own plain-words messages passed on. */
/** Calls to the online app, with its own plain-words messages (and code) passed on; `body` undefined: a GET. */
class OnlineSaid extends BadRequestException {
  constructor(message: string, readonly onlineCode?: string) {
    super({ message });
  }
}
async function cloud<T>(path: string, body: unknown, token?: string): Promise<T> {
  const base = config().CLOUD_URL!.replace(/\/+$/, '');
  let r: globalThis.Response;
  try {
    // the free online server may need a minute to wake up
    r = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch {
    throw new BadRequestException({ message: 'Can’t reach the online app. Check the internet connection and try again.' });
  }
  const json = (await r.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!r.ok) throw new OnlineSaid(json.message ? `The online app says: ${json.message}` : `The online app didn’t take it (error ${r.status}). Please try again.`, json.code);
  return json;
}

@Controller('cloud')
export class CloudController {
  constructor(
    private readonly svc: CloudService,
    private readonly backup: BackupService,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly tokens: TokensService,
  ) {}

  /** Online: receives a PC's books (any signed-in person; the books become their shop). */
  @Post('import')
  @HttpCode(200)
  import(@Ctx() ctx: RequestContext, @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>) {
    return this.svc.import(ctx, body);
  }

  /** On the PC: Settings › Move to cloud. */
  @RequirePermission('business.update')
  @Post('move')
  @HttpCode(200)
  async move(@Ctx() ctx: RequestContext, @Body(new ZodPipe(moveSchema)) body: z.infer<typeof moveSchema>) {
    if (config().BACKUP_FOLDERS !== 'on' || !config().CLOUD_URL) throw new NotFoundException();
    const who = { email: body.email.trim().toLowerCase(), password: body.password };
    const { accessToken } = body.create
      ? await cloud<{ accessToken: string }>('/api/auth/register', { ...who, name: body.name.trim() })
      : await cloud<{ accessToken: string }>('/api/auth/login', who);
    const shop = await this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId }, (tx) => tx.business.findUniqueOrThrow({ where: { id: ctx.businessId! }, select: { id: true, code: true, name: true } }));
    // the books as they are now: the same full copy the backups make
    const tables = await this.backup.tablesFor(ctx);
    const { body: snap } = await this.backup.buildSnapshot(ctx.businessId!);
    const here = counts(replay(tables, snap, 0n, []).books);
    const data = gzipSync(Buffer.from(JSON.stringify(snap))).toString('base64');
    const columns = Object.fromEntries(tables.map((t) => [t.name, t.columns]));
    const online = await cloud<{ code: string; name: string; already: boolean; counts: Counts }>('/api/cloud/import', { source: shop, columns, data }, accessToken);
    const matches = JSON.stringify(online.counts) === JSON.stringify(here);
    await this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email }, (tx) =>
      this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'move_to_cloud', entity: 'business', entityId: shop.id, after: { onlineBooks: online.code, account: who.email, matches, again: online.already }, ip: ctx.ip }),
    );
    return { code: online.code, name: online.name, email: who.email, already: online.already, matches, here, online: online.counts };
  }

  /** Online: the shops this account owns (the PC's sign-in page lists them). */
  @Get('shops')
  shops(@Ctx() ctx: RequestContext) {
    return this.svc.ownedShops(ctx);
  }

  /** Online: the whole books of one shop of this owner. */
  @Post('export')
  @HttpCode(200)
  export(@Ctx() ctx: RequestContext, @Body(new ZodPipe(shopOnly)) body: z.infer<typeof shopOnly>) {
    return this.svc.export(ctx, body.businessId);
  }

  /** Online: the books are on a PC now; the shop becomes view-only. */
  @Post('moved-to-pc')
  @HttpCode(200)
  movedToPc(@Ctx() ctx: RequestContext, @Body(new ZodPipe(shopOnly.extend({ pcCode: z.string().max(40) }))) body: { businessId: string; pcCode: string }) {
    return this.svc.markMoved(ctx, body.businessId, { code: body.pcCode });
  }

  /** On the PC: only in single-PC mode, with an online app to bring books from. */
  private pcOnly() {
    if (config().BACKUP_FOLDERS !== 'on' || !config().CLOUD_URL) throw new NotFoundException();
  }

  /** On the PC's sign-in page: sign in to the online app; the shops that account owns. */
  @Public()
  @Post('bring/shops')
  @HttpCode(200)
  async bringShops(@Body(new ZodPipe(bringLogin)) body: z.infer<typeof bringLogin>) {
    this.pcOnly();
    const { accessToken } = await cloud<{ accessToken: string }>('/api/auth/login', body);
    const shops = await cloud<OwnedShop[]>('/api/cloud/shops', undefined, accessToken);
    return { shops };
  }

  /**
   * On the PC's sign-in page: the chosen shop's whole books come down and become books on this PC; the
   * owner's account is made here with the same email and password (the password just typed, locked by this
   * PC itself); the counts are compared; then the online shop becomes view-only and the owner is signed in
   * here. A retry (say the internet dropped before the last step) finds the books made the first time.
   */
  @Public()
  @Post('bring')
  @HttpCode(200)
  async bring(@Body(new ZodPipe(bringSchema)) body: z.infer<typeof bringSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.pcOnly();
    const { email, password } = body;
    const { accessToken } = await cloud<{ accessToken: string }>('/api/auth/login', { email, password });
    const onlineMe = await cloud<{ user: { name: string } }>('/api/me', undefined, accessToken);

    // the owner's account on this PC: made now, or (a retry, or the same person's second shop) the one made before
    let user = await this.db.user.findUnique({ where: { email } });
    if (user && !(await verify(user.passwordHash, password).catch(() => false))) {
      throw new ConflictException({ message: 'This email already has an account on this computer, with another password. Sign in with that password instead.' });
    }
    user ??= await this.db.user.create({ data: { email, name: onlineMe.user.name ?? '', passwordHash: await hashPassword(password), lastLoginAt: new Date() } });
    const ctx: RequestContext = { userId: user.id, email, sessionId: '', businessId: null, role: null, permissions: [], ip: req.ip ?? '' };
    const newId = pcId(body.businessId);
    const tables = await this.backup.tablesFor(ctx);
    const had = await this.db.scoped({ businessId: newId, userId: user.id, email }, (tx) => tx.business.findUnique({ where: { id: newId }, select: { code: true, name: true } }));

    let online: Counts | null = null;
    let made = had;
    try {
      const exp = await cloud<{ source: { id: string; code: string; name: string }; columns: Record<string, string[]>; data: string; counts: Counts }>('/api/cloud/export', { businessId: body.businessId }, accessToken);
      online = exp.counts;
      if (!had) {
        const unknown = unknownColumns(exp.columns, tables);
        if (unknown.length) throw new ConflictException({ message: 'This app needs an update before these books can come to this PC. Click “Check for updates” at the top, restart, and try again.', unknown: unknown.slice(0, 20) });
        let snap: SnapshotBody;
        try { snap = JSON.parse(gunzipSync(Buffer.from(exp.data, 'base64')).toString('utf8')) as SnapshotBody; } catch { throw new BadRequestException({ message: 'The books arrived damaged. Please try again.' }); }
        if (!snap?.tables?.businesses?.length) throw new BadRequestException({ message: 'The books arrived without the shop’s details. Please try again.' });
        made = await this.backup.restoreInto(ctx, { tables, books: replay(tables, snap, 0n, []).books, lastAt: null }, 'bring from cloud', new Date(), exp.source.id, newId);
      }
    } catch (e) {
      // already view-only online: the books came here before (a retry after the last step), or went to another PC
      if (!(e instanceof OnlineSaid && e.onlineCode === 'moved_to_pc' && had)) throw e;
    }
    const { body: snapHere } = await this.backup.buildSnapshot(newId);
    const here = counts(replay(tables, snapHere, 0n, []).books);
    const matches = !online || JSON.stringify(online) === JSON.stringify(here);
    if (!matches) {
      throw new ConflictException({ message: 'The books came to this PC, but the counts don’t match the online ones, so the online shop was left as it was. Please contact support before billing on this PC.', here, online });
    }
    const viewOnly = await cloud<{ movedToPcOn: string }>('/api/cloud/moved-to-pc', { businessId: body.businessId, pcCode: made!.code }, accessToken);
    await this.db.scoped({ businessId: newId, userId: user.id, email }, (tx) =>
      this.audit.log(tx, { businessId: newId, userId: user.id, action: 'move_to_pc', entity: 'business', entityId: newId, after: { fromOnlineBooks: body.businessId, account: email, matches, viewOnlyOnlineFrom: viewOnly.movedToPcOn, again: !!had }, ip: ctx.ip }),
    );
    const t = await this.tokens.start(user, newId, meta(req));
    setRefreshCookie(res, t);
    return { accessToken: t.accessToken, expiresIn: t.expiresIn, code: made!.code, name: made!.name, already: !!had, matches, here, online: online ?? here };
  }
}
