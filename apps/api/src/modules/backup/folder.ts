/**
 * Backups into a folder on this computer or on a pen drive, and restoring from such files on any
 * computer with the recovery key. Only in the Windows app's single-PC mode (BACKUP_FOLDERS=on), where
 * this server runs on the shop's own PC; on the live server these addresses do not exist.
 *
 * Files go into "<chosen folder>/<app> Backup - <shop code>". When the folder is missing (the pen drive
 * is out) the place waits quietly and catches up when it is back. The newest 7 full copies (and the
 * changes after the oldest of them) are kept; older files are removed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Body, Controller, HttpCode, Injectable, NotFoundException, BadRequestException, Post, Put, type OnModuleInit } from '@nestjs/common';
import type { BackupDestination } from '@prisma/client';
import { z } from 'zod';
import { BRAND, financialYearOf, todayIst } from '@billing/shared';
import { config } from '../../config';
import { DbService } from '../../common/db.service';
import { Ctx, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestContext } from '../../common/context';
import { BackupService, type Sender } from './backup.service';
import { keyId, readHeader, type FileHeader } from './crypto';
import { chainAfter, summarise } from './restore';

export const foldersOn = () => config().BACKUP_FOLDERS === 'on';
/** full copies kept in a folder */
export const KEEP_FULL = 7;
const EXT = '.berp';

type FolderSettings = { folder?: string; dir?: string };

/** A recovery key as typed: spaces, dashes and small letters don't matter; 0 / 1 / 8 are read as O / I / B (they are not used in keys). */
export const normaliseKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');

/** Can the app write here? (makes and removes a small test file) */
function writable(dir: string): boolean {
  try {
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Writes the whole file, flushes it to the disk (a pen drive pulled out right after still has it), then gives it its name. */
function writeSafely(file: string, data: Buffer) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** Keeps the newest `keep` full copies and every change after the oldest of them; removes the rest. */
export function prune(dir: string, keep = KEEP_FULL): string[] {
  const names = fs.readdirSync(dir).filter((n) => n.endsWith(EXT)).sort();
  const fulls = names.filter((n) => n.startsWith('full-'));
  if (fulls.length <= keep) return [];
  const oldestKept = fulls[fulls.length - keep]!;
  // names start with the time they were made: "full-2026-11-10T10-00-00.berp", "changes-2026-11-10T10-01-00-123.berp"
  const since = oldestKept.slice('full-'.length, 'full-'.length + 19);
  const gone = names.filter((n) => (n.startsWith('full-') ? n < oldestKept : n.slice('changes-'.length, 'changes-'.length + 19) < since));
  for (const n of gone) fs.rmSync(path.join(dir, n), { force: true });
  return gone;
}

@Injectable()
export class FolderSender implements Sender, OnModuleInit {
  constructor(private readonly backup: BackupService) {}

  onModuleInit(): void {
    if (foldersOn()) this.backup.registerSender('local', this);
  }

  /** the chosen folder is there (the pen drive is in) and the app can write in it */
  ready(d: BackupDestination): boolean {
    const st = d.settings as FolderSettings;
    return !!st.folder && !!st.dir && fs.existsSync(st.folder) && writable(st.folder);
  }

  async put(d: BackupDestination, name: string, file: Buffer): Promise<{ ref: string }> {
    const dir = (d.settings as FolderSettings).dir!;
    try {
      fs.mkdirSync(dir, { recursive: true });
      writeSafely(path.join(dir, name), file);
      // read back: the place "confirms" only what is really on the disk
      if (!fs.readFileSync(path.join(dir, name)).equals(file)) throw new Error('The file read back differently.');
      if (name.startsWith('full-')) prune(dir);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      throw new Error(code === 'ENOSPC' ? 'The pen drive or disk is full.' : code === 'ENOENT' ? 'The pen drive or folder was removed.' : `Couldn’t save the backup in the folder (${code ?? (e as Error).message}).`);
    }
    return { ref: name };
  }

  async get(d: BackupDestination, f: { name: string; ref: string }): Promise<Buffer> {
    return fs.readFileSync(path.join((d.settings as FolderSettings).dir!, f.ref));
  }
}

/** One backup file found in a folder, with its readable header. */
interface Found extends FileHeader { file: string; afterSeqN: bigint; toSeqN: bigint }

/** Every backup file in `folder` and the folders right inside it (the owner may pick either). */
export function findFiles(folder: string): Found[] {
  const dirs = [folder, ...fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(folder, e.name))];
  const out: Found[] = [];
  for (const dir of dirs) {
    let names: string[];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith(EXT)); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      try {
        const { header } = readHeader(fs.readFileSync(file));
        out.push({ ...header, file, afterSeqN: BigInt(header.afterSeq), toSeqN: BigInt(header.toSeq) });
      } catch { /* not one of ours, or damaged: left out */ }
    }
  }
  return out;
}

/** The backup in a folder to restore: the shop whose newest file is the newest, its latest full copy and every change after it. */
export function pickBackup(found: Found[], master: string) {
  if (!found.length) throw new BadRequestException({ message: 'No backup files were found in this folder. Choose the folder named “… Backup - BE-…”, or the folder it is in.' });
  const mine = found.filter((f) => f.keyId === keyId(master));
  if (!mine.length) throw new BadRequestException({ message: 'This recovery key does not open these backups. Check the key: it is the one printed on the computer that made them.' });
  const newest = [...mine].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!;
  const shop = mine.filter((f) => f.business === newest.business);
  const snap = shop.filter((f) => f.kind === 'snapshot').sort((a, b) => (a.toSeqN < b.toSeqN ? -1 : a.toSeqN > b.toSeqN ? 1 : a.createdAt < b.createdAt ? -1 : 1)).at(-1);
  if (!snap) throw new BadRequestException({ message: 'There is no full copy in this folder, so the books can’t be rebuilt from it.' });
  const chain = chainAfter(snap.toSeqN, shop.filter((f) => f.kind === 'changes').map((f) => ({ ...f, afterSeq: f.afterSeqN, toSeq: f.toSeqN })));
  if ('gap' in chain) throw new BadRequestException({ message: chain.gap });
  return { business: newest.business, snap, changes: chain.files.map((f) => f.file), shops: new Set(mine.map((f) => f.business)).size };
}

const folderSchema = z.object({ folder: z.string().min(1).max(1000) });
const filesSchema = z.object({ folder: z.string().min(1).max(1000), key: z.string().min(1).max(200) });
const filesRestoreSchema = filesSchema.extend({ confirm: z.literal(true, { errorMap: () => ({ message: 'Tick “I understand” to restore.' }) }) });

@Controller('backup')
export class FolderController {
  constructor(
    private readonly backup: BackupService,
    private readonly db: DbService,
  ) {}

  private on() {
    if (!foldersOn()) throw new NotFoundException();
  }

  private usable(folder: string): string {
    if (!path.isAbsolute(folder)) throw new BadRequestException({ message: 'Choose a folder.' });
    const f = path.resolve(folder);
    if (!fs.existsSync(f) || !fs.statSync(f).isDirectory()) throw new BadRequestException({ message: 'That folder can’t be found. Is the pen drive plugged in?' });
    return f;
  }

  /** "Choose folder…": where the backups of this shop go from now on (a new folder starts with a full copy). */
  @RequirePermission('business.update')
  @Put('local/folder')
  async choose(@Ctx() ctx: RequestContext, @Body(new ZodPipe(folderSchema)) body: z.infer<typeof folderSchema>) {
    this.on();
    const folder = this.usable(body.folder);
    if (!writable(folder)) throw new BadRequestException({ message: 'The app can’t save files in that folder. Choose another one.' });
    const shop = await this.db.scoped({ businessId: ctx.businessId, userId: ctx.userId }, (tx) => tx.business.findUniqueOrThrow({ where: { id: ctx.businessId! }, select: { code: true } }));
    const dir = path.join(folder, `${BRAND.backupFolder} - ${shop.code}`);
    await this.backup.savePlace(ctx, 'local', { folder, dir }, true);
    return this.backup.status(ctx);
  }

  /** Opens the backup files in a folder with the recovery key, without touching any books. */
  private async open(ctx: RequestContext, folder: string, key: string) {
    const master = normaliseKey(key);
    const picked = pickBackup(findFiles(this.usable(folder)), master);
    const tables = await this.backup.tablesFor(ctx);
    const b = await this.backup.rebuild(master, picked.business, tables, picked.snap.toSeqN, async () => fs.readFileSync(picked.snap.file), picked.changes.map((f) => async () => fs.readFileSync(f)));
    return { picked, b };
  }

  /** "Restore from files…", step 1: what the backup holds (nothing is written). */
  @RequirePermission('business.update')
  @Post('files/test')
  @HttpCode(200)
  async test(@Ctx() ctx: RequestContext, @Body(new ZodPipe(filesSchema)) body: z.infer<typeof filesSchema>) {
    this.on();
    const { picked, b } = await this.open(ctx, body.folder, body.key);
    return {
      fullCopyAt: picked.snap.createdAt,
      changeFiles: picked.changes.length,
      changes: b.applied,
      upTo: b.lastAt ?? picked.snap.createdAt,
      otherShops: picked.shops - 1,
      ...summarise(b.books, financialYearOf(todayIst())),
    };
  }

  /** Step 2: the backup becomes new books for this owner; the current books are not touched. */
  @RequirePermission('business.update')
  @Post('files/restore')
  @HttpCode(200)
  async restore(@Ctx() ctx: RequestContext, @Body(new ZodPipe(filesRestoreSchema)) body: z.infer<typeof filesRestoreSchema>) {
    this.on();
    const { picked, b } = await this.open(ctx, body.folder, body.key);
    return this.backup.restoreInto(ctx, b, 'files', new Date(picked.snap.createdAt), picked.business);
  }
}

