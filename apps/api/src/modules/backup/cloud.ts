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
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BadRequestException, Body, ConflictException, Controller, HttpCode, Injectable, NotFoundException, Post } from '@nestjs/common';
import { z } from 'zod';
import { financialYearOf, todayIst } from '@billing/shared';
import { config } from '../../config';
import { AuditService } from '../../common/audit.service';
import { DbService } from '../../common/db.service';
import { Ctx, RequirePermission } from '../../common/decorators';
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
}

/** Calls to the online app, with its own plain-words messages passed on. */
async function cloud<T>(path: string, body: unknown, token?: string): Promise<T> {
  const base = config().CLOUD_URL!.replace(/\/+$/, '');
  let r: Response;
  try {
    // the free online server may need a minute to wake up
    r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
  } catch {
    throw new BadRequestException({ message: 'Can’t reach the online app. Check the internet connection and try again.' });
  }
  const json = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new BadRequestException({ message: json.message ? `The online app says: ${json.message}` : `The online app didn’t take it (error ${r.status}). Please try again.` });
  return json;
}

@Controller('cloud')
export class CloudController {
  constructor(
    private readonly svc: CloudService,
    private readonly backup: BackupService,
    private readonly db: DbService,
    private readonly audit: AuditService,
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
}
