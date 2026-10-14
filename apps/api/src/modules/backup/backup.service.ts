/**
 * Real-time backup: numbers each shop's saved changes, packs the ones a destination hasn't
 * confirmed into a locked file, sends it, and moves the destination's bookmark only after the
 * destination confirms. A full copy goes to each destination once a day (India time).
 * Restore = latest full copy + every later change: tested in memory first, and a real restore
 * goes into new books, so the current books are never overwritten.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type BackupDestination, type BackupFile } from '@prisma/client';
import { financialYearOf, todayIst } from '@billing/shared';
import { config } from '../../config';
import { DbService, type DbScope, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { BackupFileError, lockFile, openFile, sha256 } from './crypto';
import { NOT_RESTORED, q, shopTables, type TableInfo } from './tables';
import { chainAfter, countsOf, remapIds, replay, summarise, upgradeSeries, type Change, type ChangesBody, type Row, type SnapshotBody } from './restore';

export type DestKind = 'drive' | 'local';
export type DestChoice = DestKind | 'both' | null;
export const KINDS: readonly DestKind[] = ['drive', 'local'];

/** A place backups are sent to (Google Drive comes in its own step). */
export interface Sender {
  /** connected and ready for this shop; until then the destination waits quietly */
  ready(d: BackupDestination): boolean | Promise<boolean>;
  /** stores the file and resolves only once the destination has confirmed it; errors in plain words, never a token */
  put(d: BackupDestination, name: string, file: Buffer): Promise<{ ref: string }>;
  get(d: BackupDestination, f: { name: string; ref: string }): Promise<Buffer>;
}

export type RunResult = 'sent' | 'up_to_date' | 'not_ready' | 'busy' | 'failed' | 'off';

/** A place's failure that needs more than a retry: the owner must connect again, or the place lost its copies and starts over with a full copy. */
export class PlaceError extends Error {
  constructor(message: string, readonly opts: { reconnect?: boolean; restart?: boolean } = {}) {
    super(message);
  }
}
type PlaceSettings = { folder?: string; account?: string; folderId?: string; reconnect?: boolean };

/** changes per file */
const BATCH = 5000;
/** minutes to wait after the 1st, 2nd, 3rd … failure in a row */
const BACKOFF_MIN = [1, 2, 4, 8, 15];
/** a red banner after this long without a working backup */
export const FAIL_MINUTES = 15;

const stamp = (d: Date) => d.toISOString().slice(0, 19).replace(/:/g, '-');
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const choiceOf = (ds: Pick<BackupDestination, 'kind' | 'enabled'>[]): DestChoice => {
  const on = ds.filter((d) => d.enabled).map((d) => d.kind);
  return on.length === 2 ? 'both' : ((on[0] as DestKind | undefined) ?? null);
};
const plain = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error').slice(0, 300);
const scopeOf = (ctx: RequestContext): DbScope => ({ businessId: ctx.businessId, userId: ctx.userId, email: ctx.email });
/** compared without the audit log, which a test restore itself writes to */
const COMPARED = (t: TableInfo) => !(NOT_RESTORED as readonly string[]).includes(t.name) && t.name !== 'audit_log';

@Injectable()
export class BackupService {
  private readonly log = new Logger('Backup');
  private readonly senders = new Map<DestKind, Sender>();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  registerSender(kind: DestKind, s: Sender): void {
    this.senders.set(kind, s);
  }

  private key(): string | null {
    return config().BACKUP_MASTER_KEY ?? null;
  }

  /** Numbers this shop's committed changes 1, 2, 3 … in commit order (one numbering at a time per shop). */
  async seal(businessId: string): Promise<void> {
    await this.db.scoped({ businessId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext('backup-seal'), hashtext(${businessId}))) x`;
      await tx.$executeRaw`
        UPDATE change_log c SET seq = s.base + s.rn
        FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn,
                     (SELECT coalesce(max(seq), 0) FROM change_log WHERE seq IS NOT NULL) AS base
              FROM change_log WHERE seq IS NULL) s
        WHERE c.id = s.id`;
    });
  }

  private async lastSeq(tx: Tx): Promise<bigint> {
    const [r] = await tx.$queryRaw<{ s: bigint | null }[]>`SELECT max(seq) AS s FROM change_log`;
    return r?.s ?? 0n;
  }

  /** Settings › Backup: Google Drive, this computer, both, or none. A place switched on starts from now with a full copy. */
  async choose(ctx: RequestContext, choice: DestChoice): Promise<void> {
    const businessId = ctx.businessId!;
    const want = new Set<DestKind>(choice === 'both' ? KINDS : choice ? [choice] : []);
    await this.seal(businessId);
    await this.db.scoped(scopeOf(ctx), async (tx) => {
      const before = await tx.backupDestination.findMany();
      const at = await this.lastSeq(tx);
      for (const kind of KINDS) {
        const d = before.find((x) => x.kind === kind);
        const on = want.has(kind);
        if (!d && on) await tx.backupDestination.create({ data: { businessId, kind, cursorSeq: at, createdBy: ctx.userId } });
        else if (d && d.enabled !== on) {
          await tx.backupDestination.update({
            where: { id: d.id },
            data: on ? { enabled: true, cursorSeq: at, lastSnapshotAt: null, failingSince: null, lastError: '', attempts: 0, nextTryAt: null } : { enabled: false },
          });
        }
      }
      const was = choiceOf(before);
      if (was !== choice) await this.audit.log(tx, { businessId, userId: ctx.userId, action: 'update', entity: 'backup_destination', before: { dest: was }, after: { dest: choice }, ip: ctx.ip });
    });
  }

  async status(ctx: RequestContext) {
    return this.db.scoped(scopeOf(ctx), async (tx) => {
      const ds = await tx.backupDestination.findMany();
      const [{ unnumbered = 0 } = {}] = await tx.$queryRaw<{ unnumbered: number }[]>`SELECT count(*)::int AS unnumbered FROM change_log WHERE seq IS NULL`;
      const [{ size = 0n } = {}] = await tx.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
      const line = async (kind: DestKind) => {
        const d = ds.find((x) => x.kind === kind);
        if (!d) return null;
        const [{ n = 0 } = {}] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM change_log WHERE seq > ${d.cursorSeq}`;
        const s = this.senders.get(kind);
        const st = d.settings as PlaceSettings;
        return {
          enabled: d.enabled,
          connected: !!s && (await s.ready(d)),
          reconnect: !!st.reconnect,
          folder: st.folder ?? '',
          account: st.account ?? '',
          lastOkAt: d.lastOkAt,
          failingSince: d.failingSince,
          error: d.lastError || null,
          waiting: n + unnumbered,
          lastSnapshotAt: d.lastSnapshotAt,
        };
      };
      const snaps = ds.filter((d) => d.enabled && d.lastSnapshotAt).map((d) => +d.lastSnapshotAt!);
      return {
        keySet: !!this.key(),
        /** Google Drive can be connected on this server (its Google client is set) */
        driveSetUp: this.senders.has('drive'),
        dest: choiceOf(ds),
        drive: await line('drive'),
        local: await line('local'),
        snapshot: { lastAt: snaps.length ? new Date(Math.max(...snaps)) : null },
        space: { usedMb: Math.round(Number(size) / 1048576), limitMb: config().DB_SPACE_LIMIT_MB },
        failMinutes: FAIL_MINUTES,
        now: new Date(),
      };
    });
  }

  /** Every minute (BackupWorker): each switched-on place that is due. */
  async runDue(): Promise<void> {
    if (!this.key()) return;
    const due = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.worker', 'backup', true)`;
      return tx.$queryRaw<{ id: string; business_id: string }[]>`
        SELECT id::text, business_id::text FROM backup_destinations
        WHERE enabled AND (next_try_at IS NULL OR next_try_at <= now()) AND (lease_until IS NULL OR lease_until < now())
        ORDER BY business_id, kind`;
    });
    for (const d of due) await this.run(d.business_id, d.id);
  }

  /** "Backup now": every switched-on place of this shop, without waiting for a retry time. */
  async now(ctx: RequestContext): Promise<Partial<Record<DestKind, RunResult>>> {
    const ds = await this.db.scoped(scopeOf(ctx), (tx) => tx.backupDestination.findMany({ where: { enabled: true }, orderBy: { kind: 'asc' } }));
    const out: Partial<Record<DestKind, RunResult>> = {};
    for (const d of ds) out[d.kind as DestKind] = await this.run(ctx.businessId!, d.id, { now: true });
    return out;
  }

  /** Sends what one place hasn't confirmed yet: today's full copy if missing, then the changes. */
  async run(businessId: string, destId: string, opts: { now?: boolean } = {}): Promise<RunResult> {
    const master = this.key();
    if (!master) return 'off';
    const due = opts.now ? Prisma.empty : Prisma.sql`AND (next_try_at IS NULL OR next_try_at <= now())`;
    const got = await this.db.scoped({ businessId }, (tx) => tx.$executeRaw`
      UPDATE backup_destinations SET lease_until = now() + interval '10 minutes'
      WHERE id = ${destId}::uuid AND enabled AND (lease_until IS NULL OR lease_until < now()) ${due}`);
    if (!got) return 'busy';
    try {
      const d = await this.db.scoped({ businessId }, (tx) => tx.backupDestination.findUniqueOrThrow({ where: { id: destId } }));
      const sender = this.senders.get(d.kind as DestKind);
      if (!sender || !(await sender.ready(d))) return 'not_ready';
      await this.seal(businessId);
      let sent = false;
      if (!d.lastSnapshotAt || todayIst(d.lastSnapshotAt) < todayIst()) {
        await this.sendSnapshot(master, d, sender);
        sent = true;
      }
      while (await this.sendChanges(master, businessId, destId, sender)) sent = true;
      // (only the flag is changed in settings: the place may have saved e.g. its folder during this round)
      await this.db.scoped({ businessId }, (tx) => tx.$executeRaw`
        UPDATE backup_destinations SET last_ok_at = now(), failing_since = NULL, last_error = '', attempts = 0, next_try_at = NULL,
          settings = settings || '{"reconnect": false}'::jsonb, updated_at = now()
        WHERE id = ${destId}::uuid`);
      return sent ? 'sent' : 'up_to_date';
    } catch (e) {
      const msg = plain(e);
      this.log.warn(`Backup ${destId} failed: ${msg}`);
      await this.db.scoped({ businessId }, async (tx) => {
        const d = await tx.backupDestination.findUniqueOrThrow({ where: { id: destId } });
        const attempts = d.attempts + 1;
        const wait = BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1]!;
        await tx.backupDestination.update({
          where: { id: destId },
          data: {
            failingSince: d.failingSince ?? new Date(), lastError: msg, attempts, nextTryAt: new Date(Date.now() + wait * 60_000),
            ...(e instanceof PlaceError && e.opts.reconnect ? { settings: { ...(d.settings as PlaceSettings), reconnect: true } } : {}),
            ...(e instanceof PlaceError && e.opts.restart ? { lastSnapshotAt: null } : {}),
          },
        });
      });
      return 'failed';
    } finally {
      await this.db.scoped({ businessId }, (tx) => tx.$executeRaw`UPDATE backup_destinations SET lease_until = NULL WHERE id = ${destId}::uuid`).catch(() => undefined);
    }
  }

  /** One file of changes after the bookmark; returns how many were sent (0: up to date). */
  private async sendChanges(master: string, businessId: string, destId: string, sender: Sender): Promise<number> {
    const { d, rows } = await this.db.scoped({ businessId }, async (tx) => {
      const d = await tx.backupDestination.findUniqueOrThrow({ where: { id: destId } });
      const rows = await tx.changeLog.findMany({ where: { seq: { gt: d.cursorSeq } }, orderBy: { seq: 'asc' }, take: BATCH, select: { seq: true, tbl: true, op: true, data: true, at: true } });
      return { d, rows };
    });
    if (!rows.length) return 0;
    const toSeq = rows[rows.length - 1]!.seq!;
    const now = new Date();
    const body: ChangesBody = { changes: rows.map((r) => ({ s: String(r.seq), t: r.tbl, o: r.op as Change['o'], d: r.data as Row, at: r.at.toISOString() })) };
    const file = lockFile(master, { business: businessId, kind: 'changes', afterSeq: String(d.cursorSeq), toSeq: String(toSeq), createdAt: now.toISOString() }, body);
    const name = `changes-${stamp(now)}-${toSeq}.berp`;
    const { ref } = await sender.put(d, name, file);
    // confirmed: only now does the bookmark move (and only if nobody else moved it meanwhile)
    await this.db.scoped({ businessId }, async (tx) => {
      const moved = await tx.backupDestination.updateMany({ where: { id: destId, cursorSeq: d.cursorSeq }, data: { cursorSeq: toSeq } });
      if (!moved.count) throw new Error('This backup was moved on by another server at the same time.');
      await tx.backupFile.create({ data: { businessId, destinationId: destId, kind: 'changes', name, afterSeq: d.cursorSeq, toSeq, changes: rows.length, bytes: file.length, sha256: sha256(file), ref } });
    });
    return rows.length;
  }

  /** The shop's whole books as of one moment, and the last change number already in them. */
  async buildSnapshot(businessId: string): Promise<{ upto: bigint; body: SnapshotBody; rows: number }> {
    return this.db.scoped({ businessId }, async (tx) => {
      const upto = await this.lastSeq(tx);
      const tables: Record<string, Row[]> = {};
      let rows = 0;
      for (const t of await shopTables(tx)) {
        const got = await tx.$queryRawUnsafe<{ r: Row }[]>(`SELECT to_jsonb(t) AS r FROM ${q(t.name)} t WHERE ${q(t.shopCol)} = $1::uuid`, businessId);
        tables[t.name] = got.map((x) => x.r);
        rows += got.length;
      }
      return { upto, body: { tables }, rows };
    }, { repeatable: true, timeout: 120_000 });
  }

  private async sendSnapshot(master: string, d: BackupDestination, sender: Sender): Promise<void> {
    const { upto, body, rows } = await this.buildSnapshot(d.businessId);
    const now = new Date();
    const file = lockFile(master, { business: d.businessId, kind: 'snapshot', afterSeq: String(upto), toSeq: String(upto), createdAt: now.toISOString() }, body);
    const name = `full-${stamp(now)}.berp`;
    const { ref } = await sender.put(d, name, file);
    await this.db.scoped({ businessId: d.businessId }, async (tx) => {
      await tx.backupFile.create({ data: { businessId: d.businessId, destinationId: d.id, kind: 'snapshot', name, afterSeq: upto, toSeq: upto, changes: rows, bytes: file.length, sha256: sha256(file), ref } });
      await tx.backupDestination.update({ where: { id: d.id }, data: { lastSnapshotAt: now } });
    });
  }

  /** Reads the latest full copy and every later change file back from a place, checks them and rebuilds the books in memory. */
  private async load(ctx: RequestContext, kind: DestKind) {
    const master = this.key();
    if (!master) throw new BadRequestException({ message: 'Backups are not switched on for this server yet.' });
    const businessId = ctx.businessId!;
    const { d, files, tables } = await this.db.scoped(scopeOf(ctx), async (tx) => {
      const d = await tx.backupDestination.findFirst({ where: { kind } });
      if (!d) throw new NotFoundException({ message: 'Nothing has been backed up to this place yet.' });
      return { d, files: await tx.backupFile.findMany({ where: { destinationId: d.id }, orderBy: { createdAt: 'asc' } }), tables: await shopTables(tx) };
    });
    const sender = this.senders.get(kind);
    if (!sender || !(await sender.ready(d))) throw new BadRequestException({ message: kind === 'drive' ? 'Google Drive is not connected.' : 'The backup folder on this computer is not available.' });
    const snap = files.filter((f) => f.kind === 'snapshot').at(-1);
    if (!snap) throw new BadRequestException({ message: 'There is no full copy in this backup yet. The first one is made within a minute of choosing where to keep backups.' });
    const chain = chainAfter(snap.toSeq, files.filter((f) => f.kind === 'changes'));
    if ('gap' in chain) throw new BadRequestException({ message: chain.gap });
    const fetch = async (f: BackupFile) => {
      let b: Buffer;
      try { b = await sender.get(d, { name: f.name, ref: f.ref }); } catch (e) { throw new BackupFileError(`Couldn’t read ${f.name}: ${plain(e)}`); }
      if (sha256(b) !== f.sha256) throw new BackupFileError(`The file ${f.name} has been changed or damaged.`);
      return b;
    };
    try {
      const s = openFile<SnapshotBody>(master, businessId, await fetch(snap));
      const bundles: ChangesBody[] = [];
      for (const f of chain.files) bundles.push(openFile<ChangesBody>(master, businessId, await fetch(f)).body);
      return { tables, snap, files: chain.files, ...replay(tables, s.body, snap.toSeq, bundles) };
    } catch (e) {
      if (e instanceof BackupFileError) throw new BadRequestException({ message: e.message });
      throw e;
    }
  }

  /** Test restore: rebuilds the books from the backup and compares them with the books as they are now. Nothing is written except the audit entry. */
  async testRestore(ctx: RequestContext, kind: DestKind) {
    const b = await this.load(ctx, kind);
    const backup = countsOf(b.books);
    const now = await this.db.scoped(scopeOf(ctx), async (tx) => {
      const out: Record<string, number> = {};
      for (const t of b.tables.filter(COMPARED)) {
        const [r] = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t.name)} WHERE ${q(t.shopCol)} = $1::uuid`, ctx.businessId);
        out[t.name] = r?.n ?? 0;
      }
      return out;
    });
    const differences = Object.keys(now).filter((t) => (backup[t] ?? 0) !== now[t]).map((t) => ({ table: t, backup: backup[t] ?? 0, now: now[t]! }));
    const result = {
      from: kind,
      fullCopyAt: b.snap.createdAt,
      changeFiles: b.files.length,
      changes: b.applied,
      upTo: b.lastAt ? new Date(b.lastAt) : b.snap.createdAt,
      ...summarise(b.books, financialYearOf(todayIst())),
      matches: !differences.length,
      differences,
    };
    await this.db.scoped(scopeOf(ctx), (tx) =>
      this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'test_restore', entity: 'backup', after: { from: kind, fullCopyAt: result.fullCopyAt, changes: result.changes, matches: result.matches }, ip: ctx.ip }),
    );
    return result;
  }

  /**
   * Restore: the backup becomes new books for this owner (as Start fresh does); the current books
   * are kept untouched and stay in the shop menu. Staff are invited to the new books again.
   */
  async restore(ctx: RequestContext, kind: DestKind) {
    const b = await this.load(ctx, kind);
    const oldId = ctx.businessId!;
    const newId = randomUUID();
    const books = remapIds(b.books, b.tables, oldId, newId);
    upgradeSeries(books);
    const biz = [...(books.get('businesses')?.values() ?? [])][0];
    if (!biz) throw new BadRequestException({ message: 'This backup has no business details.' });
    const { cur, me } = await this.db.scoped(scopeOf(ctx), async (tx) => ({
      cur: await tx.business.findUniqueOrThrow({ where: { id: oldId } }),
      me: await tx.membership.findFirst({ where: { businessId: oldId, userId: ctx.userId } }),
    }));
    const upTo = b.lastAt ?? b.snap.createdAt.toISOString();
    const created = await this.db.scoped({ businessId: newId, userId: ctx.userId, email: ctx.email }, async (tx) => {
      const [row] = await tx.$queryRaw<{ code: string }[]>`SELECT 'BE-' || nextval('business_code_seq') AS code`;
      const code = row!.code;
      const info = (n: string) => b.tables.find((t) => t.name === n)!;
      // the plan stays as it is now: a restore is not a new free trial
      await insertRows(tx, info('businesses'), [{
        ...biz, id: newId, code, owner_user_id: ctx.userId, created_by: ctx.userId, updated_at: new Date().toISOString(),
        plan_status: cur.planStatus, trial_ends_on: dateOnly(cur.trialEndsOn), paid_until: cur.paidUntil ? dateOnly(cur.paidUntil) : null,
      }]);
      const owner = await tx.role.findFirstOrThrow({ where: { businessId: null, key: 'owner' } });
      await tx.membership.create({ data: { businessId: newId, userId: ctx.userId, roleId: owner.id, displayName: me?.displayName ?? '', createdBy: ctx.userId } });
      for (const t of b.tables) {
        if (t.name === 'businesses' || (NOT_RESTORED as readonly string[]).includes(t.name)) continue;
        const rows = [...(books.get(t.name)?.values() ?? [])];
        if (rows.length) await insertRows(tx, t, rows);
      }
      await this.audit.log(tx, { businessId: newId, userId: ctx.userId, action: 'restore', entity: 'backup', entityId: newId, after: { from: kind, fromBooks: cur.code, fullCopyAt: b.snap.createdAt, upTo }, ip: ctx.ip });
      return { businessId: newId, code, name: String(biz.name ?? '') };
    }, { timeout: 600_000 });
    await this.db.scoped(scopeOf(ctx), (tx) =>
      this.audit.log(tx, { businessId: oldId, userId: ctx.userId, action: 'restore', entity: 'backup', entityId: newId, after: { from: kind, intoBooks: created.code, fullCopyAt: b.snap.createdAt, upTo }, ip: ctx.ip }),
    );
    return created;
  }
}

/** Inserts rows given as JSON (column → value), only the columns the table has now; Postgres converts the types. */
async function insertRows(tx: Tx, t: TableInfo, rows: Row[]): Promise<void> {
  const have = new Set(t.columns);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const cols = Object.keys(r).filter((k) => have.has(k)).sort().join(',');
    const g = groups.get(cols);
    if (g) g.push(r);
    else groups.set(cols, [r]);
  }
  for (const [cols, rs] of groups) {
    const list = cols.split(',').map(q).join(', ');
    for (let i = 0; i < rs.length; i += 500) {
      await tx.$executeRawUnsafe(`INSERT INTO ${q(t.name)} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${q(t.name)}, $1::jsonb)`, JSON.stringify(rs.slice(i, i + 500)));
    }
  }
}
