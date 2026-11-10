/**
 * Google Drive as a backup place. Narrowest permission only: drive.file ("files this app created"),
 * so the app sees nothing in the owner's Drive except its own folder "<BRAND.backupFolder> - <shop>".
 * The folder is found by its saved id, never by its name: renaming the app (packages/shared/src/brand.ts)
 * leaves a shop's existing folder and its backups as they are; only a new folder gets the new name.
 *
 * Connecting: the owner presses "Connect Google Drive", signs in at Google and comes back to
 * Settings. The refresh token Google gives is kept locked in backup_destinations.secret (lockSecret);
 * it is never sent to the screens, written to the log or the audit log.
 */
import { BadRequestException, Controller, Get, Injectable, Logger, Post, Query, Res, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { BackupDestination } from '@prisma/client';
import type { Response as Reply } from 'express';
import { BRAND } from '@billing/shared';
import { appUrl, config } from '../../config';
import { Ctx, Public, RequirePermission } from '../../common/decorators';
import { DbService } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { BackupService, PlaceError, type Sender } from './backup.service';
import { lockSecret, openSecret, readHeader } from './crypto';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'application/vnd.google-apps.folder';
/**
 * Where Google sends the browser back. Single-PC mode (a "Desktop app" client): this computer's bare
 * address, the form Google documents for desktop apps; the PC's server passes it on to the callback.
 */
const callbackUrl = () => (config().BACKUP_FOLDERS === 'on' ? `${appUrl()}/` : `${appUrl()}/api/backup/drive/callback`);
const google = () => {
  const c = config();
  return { id: c.GOOGLE_CLIENT_ID, secret: c.GOOGLE_CLIENT_SECRET, accounts: c.GOOGLE_ACCOUNTS_URL, oauth2: c.GOOGLE_OAUTH2_URL, api: c.GOOGLE_API_URL };
};
export const driveSetUp = () => !!(config().GOOGLE_CLIENT_ID && config().GOOGLE_CLIENT_SECRET && config().BACKUP_MASTER_KEY);
/** the sign-in state Google hands back: signed with its own key, so it can never pass for a sign-in token */
const stateKey = () => config().JWT_SECRET + ':backup-drive-state';
type Settings = { folder?: string; account?: string; folderId?: string; reconnect?: boolean };

/** the Windows app's single-PC mode (its server is on the shop's PC) */
const onThisPc = () => config().BACKUP_FOLDERS === 'on';

/** The page the computer's web browser shows after Google sign-in, in single-PC mode. */
function backToApp(r: string): string {
  const [title, text] = r === 'connected'
    ? ['Google Drive is connected', `Backups now go to your Google Drive. Close this tab and go back to ${BRAND.name}.`]
    : r === 'cancelled'
      ? ['Google Drive was not connected', `You cancelled at Google. Close this tab and go back to ${BRAND.name} to try again.`]
      : ['Google Drive could not be connected', `Close this tab, go back to ${BRAND.name} and press “Connect Google Drive” again.`];
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5fa;color:#151b2e;font:16px/1.55 "Segoe UI",system-ui,sans-serif}
main{width:min(460px,calc(100vw - 32px));background:#fff;border:1px solid #e8eaf2;border-radius:14px;padding:28px}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#66708a}</style>
</head><body><main id="driveBack" data-result="${esc(r)}"><h1>${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`;
}

/** Calls to Google with errors in plain words; Google's own messages stay out of the screens. */
async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new PlaceError('Can’t reach Google Drive.');
  }
}

async function exchange(form: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string }> {
  const r = await call(`${google().oauth2}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  return (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string };
}

@Injectable()
export class DriveSender implements Sender, OnModuleInit {
  private readonly log = new Logger('Backup');
  /** short-lived access tokens, per place (not stored anywhere) */
  private readonly access = new Map<string, { token: string; until: number }>();

  constructor(
    private readonly backup: BackupService,
    private readonly db: DbService,
  ) {}

  onModuleInit(): void {
    if (driveSetUp()) this.backup.registerSender('drive', this);
    else if (config().NODE_ENV === 'production') this.log.warn('Google Drive backups are off: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.');
  }

  ready(d: BackupDestination): boolean {
    return !!d.secret;
  }

  private async token(d: BackupDestination): Promise<string> {
    const had = this.access.get(d.id);
    if (had && had.until > Date.now() + 60_000) return had.token;
    const g = google();
    const refresh = openSecret(config().BACKUP_MASTER_KEY!, d.businessId, d.secret);
    const t = await exchange({ grant_type: 'refresh_token', refresh_token: refresh, client_id: g.id!, client_secret: g.secret! });
    if (!t.access_token) {
      this.access.delete(d.id);
      if (t.error === 'invalid_grant') throw new PlaceError('Google Drive access was removed. Press “Connect again”.', { reconnect: true });
      throw new PlaceError('Google didn’t let the app sign in to Drive. The app keeps trying.');
    }
    this.access.set(d.id, { token: t.access_token, until: Date.now() + (t.expires_in ?? 3600) * 1000 });
    return t.access_token;
  }

  /** Google's answer, or a plain-words error (one fresh sign-in when Google says the access token ran out) */
  private async drive(d: BackupDestination, url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const r = await call(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await this.token(d)}` } });
    if (r.status === 401 && retry) {
      this.access.delete(d.id);
      return this.drive(d, url, init, false);
    }
    if (r.ok) return r;
    const body = (await r.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason ?? '';
    if (reason === 'storageQuotaExceeded') throw new PlaceError('Google Drive is full. Free some space in Google Drive.');
    if (r.status === 401 || r.status === 403 && /insufficient|Permission/i.test(reason)) throw new PlaceError('Google Drive access was removed. Press “Connect again”.', { reconnect: true });
    if (r.status === 404) throw Object.assign(new PlaceError('A backup file or folder is missing in Google Drive.'), { notFound: true });
    throw new PlaceError(`Google Drive didn’t take the file (error ${r.status}). The app keeps trying.`);
  }

  /** The backup folder, made the first time (its id is kept in the place's settings). */
  private async folder(d: BackupDestination): Promise<string> {
    const fresh = await this.db.scoped({ businessId: d.businessId }, (tx) => tx.backupDestination.findUniqueOrThrow({ where: { id: d.id } }));
    const st = fresh.settings as Settings;
    if (st.folderId) {
      // still there and not in the bin? (files put into a binned folder would be lost after 30 days)
      let gone = false;
      try {
        const f = (await (await this.drive(d, `${google().api}/drive/v3/files/${encodeURIComponent(st.folderId)}?fields=id,trashed`)).json()) as { trashed?: boolean };
        gone = !!f.trashed;
      } catch (e) {
        if (!(e as { notFound?: boolean }).notFound) throw e;
        gone = true;
      }
      if (!gone) return st.folderId;
      await this.db.scoped({ businessId: d.businessId }, (tx) => tx.$executeRaw`
        UPDATE backup_destinations SET settings = settings - 'folderId', updated_at = now() WHERE id = ${d.id}::uuid`);
      throw new PlaceError('The backup folder was removed from Google Drive. A new one is made on the next try.', { restart: true });
    }
    const shop = await this.db.scoped({ businessId: d.businessId }, (tx) => tx.business.findUniqueOrThrow({ where: { id: d.businessId }, select: { name: true } }));
    const name = `${BRAND.backupFolder} - ${shop.name}`.slice(0, 200);
    const r = await this.drive(d, `${google().api}/drive/v3/files?fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER }) });
    const { id } = (await r.json()) as { id: string };
    await this.db.scoped({ businessId: d.businessId }, (tx) => tx.$executeRaw`
      UPDATE backup_destinations SET settings = settings || ${JSON.stringify({ folderId: id, folder: name })}::jsonb, updated_at = now() WHERE id = ${d.id}::uuid`);
    return id;
  }

  /** Uploads in two steps (Google's resumable upload, fine for big full copies) and checks Google kept every byte. */
  async put(d: BackupDestination, name: string, file: Buffer): Promise<{ ref: string }> {
    const parent = await this.folder(d);
    const start = await this.drive(d, `${google().api}/upload/drive/v3/files?uploadType=resumable&fields=id,size`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/octet-stream', 'x-upload-content-length': String(file.length) },
      body: JSON.stringify({ name, parents: [parent], mimeType: 'application/octet-stream' }),
    });
    const at = start.headers.get('location');
    if (!at) throw new PlaceError('Google Drive didn’t start the upload. The app keeps trying.');
    const done = await this.drive(d, at, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(file) });
    const got = (await done.json()) as { id?: string; size?: string };
    if (!got.id || Number(got.size) !== file.length) throw new PlaceError('Google Drive didn’t confirm the whole file. The app sends it again.');
    return { ref: got.id };
  }

  async get(d: BackupDestination, f: { name: string; ref: string }): Promise<Buffer> {
    const r = await this.drive(d, `${google().api}/drive/v3/files/${encodeURIComponent(f.ref)}?alt=media`);
    return Buffer.from(await r.arrayBuffer());
  }

  /** Every page of a Drive file listing. */
  private async list(d: BackupDestination, q: string): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    let page = '';
    do {
      const p = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name)', pageSize: '1000', ...(page ? { pageToken: page } : {}) });
      const r = (await (await this.drive(d, `${google().api}/drive/v3/files?${p}`)).json()) as { files?: { id: string; name: string }[]; nextPageToken?: string };
      out.push(...(r.files ?? []));
      page = r.nextPageToken ?? '';
    } while (page);
    return out;
  }

  /**
   * Restore from Google Drive on another computer: this app's backup folders in the connected Drive
   * (drive.file shows only what this app made, from any computer), except these books' own folder.
   * The newest folder that `keyId` opens wins: its latest full copy and the change files from shortly
   * before it on are downloaded; the rest stays in Drive.
   */
  async backupFiles(d: BackupDestination, keyId: string): Promise<{ files: { name: string; bytes: Buffer }[]; folders: number; otherKey: boolean }> {
    const own = (d.settings as Settings).folderId;
    const folders = (await this.list(d, `mimeType='${FOLDER}' and trashed=false`)).filter((f) => f.id !== own);
    const found: { files: { id: string; name: string }[]; full: { id: string; name: string } }[] = [];
    for (const f of folders) {
      const files = (await this.list(d, `'${f.id.replace(/'/g, '')}' in parents and trashed=false`)).filter((x) => x.name.endsWith('.berp'));
      const full = files.filter((x) => x.name.startsWith('full-')).sort((a, b) => (a.name < b.name ? -1 : 1)).at(-1);
      if (full) found.push({ files, full });
    }
    found.sort((a, b) => (a.full.name < b.full.name ? 1 : -1));
    let best: { files: { id: string; name: string }[]; full: string; bytes: Buffer } | null = null;
    for (const f of found) {
      const bytes = await this.get(d, { name: f.full.name, ref: f.full.id });
      let fits = false;
      try { fits = readHeader(bytes).header.keyId === keyId; } catch { /* not one of ours */ }
      if (fits) { best = { files: f.files, full: f.full.name, bytes }; break; }
    }
    if (!best) return { files: [], folders: found.length, otherKey: found.length > 0 };
    // changes made from 10 minutes before the full copy on (a change file can be a little older than the copy it follows)
    const since = new Date(Date.parse(best.full.slice(5, 15) + 'T' + best.full.slice(16, 24).replace(/-/g, ':') + 'Z') - 10 * 60_000).toISOString().slice(0, 19).replace(/:/g, '-');
    const need = best.files.filter((x) => x.name.startsWith('changes-') && x.name.slice(8, 27) >= since);
    const out: { name: string; bytes: Buffer }[] = [{ name: best.full, bytes: best.bytes }];
    for (const x of need) out.push({ name: x.name, bytes: await this.get(d, { name: x.name, ref: x.id }) });
    return { files: out, folders: found.length, otherKey: false };
  }
}

@Controller('backup/drive')
export class DriveController {
  private readonly log = new Logger('Backup');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  /** Where to send the owner to sign in at Google (the screen opens it). */
  @RequirePermission('business.update')
  @Post('connect')
  async connect(@Ctx() ctx: RequestContext) {
    if (!driveSetUp()) throw new BadRequestException({ message: 'Google Drive isn’t set up on this server yet.' });
    const state = await this.jwt.signAsync({ b: ctx.businessId, u: ctx.userId, n: randomBytes(8).toString('hex') }, { secret: stateKey(), expiresIn: 15 * 60 });
    const q = new URLSearchParams({
      client_id: google().id!, redirect_uri: callbackUrl(), response_type: 'code', scope: DRIVE_SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state,
    });
    return { url: `${google().accounts}/o/oauth2/v2/auth?${q}` };
  }

  /**
   * Google sends the owner back here; then on to Settings with ?drive=connected / cancelled / failed.
   * In the Windows app's single-PC mode the sign-in happens in the computer's own web browser (Google
   * does not allow it inside apps), so that browser gets a short page saying to go back to the app,
   * which sees the new state by itself.
   */
  @Public()
  @Get('callback')
  async callback(@Query() q: Record<string, string | undefined>, @Res() res: Reply) {
    const back = (r: string) => (onThisPc() ? res.status(200).type('html').send(backToApp(r)) : res.redirect(302, `${appUrl()}/settings?drive=${r}`));
    let s: { b: string; u: string };
    try { s = await this.jwt.verifyAsync(q.state ?? '', { secret: stateKey() }); } catch { return back('failed'); }
    if (q.error || !q.code) return back(q.error === 'access_denied' ? 'cancelled' : 'failed');
    if (!driveSetUp()) return back('failed');
    try {
      const g = google();
      const t = await exchange({ grant_type: 'authorization_code', code: q.code, redirect_uri: callbackUrl(), client_id: g.id!, client_secret: g.secret! });
      const scopes = (t.scope ?? '').split(' ');
      if (!t.refresh_token || !t.access_token || !scopes.includes(DRIVE_SCOPE)) return back('failed');
      // the account the files go to (read through Drive itself: no extra permission)
      const about = await call(`${g.api}/drive/v3/about?fields=user(emailAddress)`, { headers: { authorization: `Bearer ${t.access_token}` } });
      const account = ((await about.json().catch(() => ({}))) as { user?: { emailAddress?: string } }).user?.emailAddress ?? '';
      const ok = await this.db.scoped({ businessId: s.b, userId: s.u }, async (tx) => {
        // still the owner of that shop?
        const m = await tx.membership.findFirst({ where: { businessId: s.b, userId: s.u, status: 'active' }, include: { role: { include: { permissions: true } } } });
        if (!m?.role.permissions.some((p) => p.permission === 'business.update')) return false;
        const secret = lockSecret(config().BACKUP_MASTER_KEY!, s.b, t.refresh_token!);
        const had = await tx.backupDestination.findFirst({ where: { kind: 'drive' } });
        // the same Google account keeps its folder; another account gets a new one. Either way a full copy goes first.
        const before = (had?.settings ?? {}) as Settings;
        const settings = before.account === account ? { ...before, reconnect: false } : { account, folder: '', reconnect: false };
        const data = { secret, settings, failingSince: null, lastError: '', attempts: 0, nextTryAt: null, lastSnapshotAt: null, leaseUntil: null };
        if (had) await tx.backupDestination.update({ where: { id: had.id }, data });
        else {
          const [r] = await tx.$queryRaw<{ s: bigint | null }[]>`SELECT max(seq) AS s FROM change_log`;
          await tx.backupDestination.create({ data: { ...data, businessId: s.b, kind: 'drive', enabled: false, cursorSeq: r?.s ?? 0n, createdBy: s.u } });
        }
        await this.audit.log(tx, { businessId: s.b, userId: s.u, action: 'update', entity: 'backup_drive', after: { connected: true, account } });
        return true;
      });
      return back(ok ? 'connected' : 'failed');
    } catch (e) {
      this.log.warn(`Connecting Google Drive failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      return back('failed');
    }
  }
}
