/**
 * Backup files: compressed (gzip) and locked (AES-256-GCM) with a key made for each shop from the
 * server's master key (HKDF-SHA256, salt = the shop's id). Nobody has to remember a password.
 *
 * File layout:  "BERPBK" | version (1 byte) | header length (4 bytes) | header JSON | iv (12) | tag (16) | locked body
 * The header (which shop, which change numbers, which key) is readable but sealed together with the
 * body, so a file can't be relabelled or moved to another shop without failing to open.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

const MAGIC = Buffer.from('BERPBK');
const VERSION = 1;

export interface FileHeader {
  app: 'billing-erp';
  business: string;
  kind: 'changes' | 'snapshot';
  /** changes: numbers after this one; snapshot: the last change number already in it */
  afterSeq: string;
  toSeq: string;
  createdAt: string;
  /** which master key locked it (a fingerprint, not the key) */
  keyId: string;
}

export class BackupFileError extends Error {}

export const keyId = (master: string) => createHash('sha256').update('billing-erp backup key id\0' + master).digest('hex').slice(0, 16);
const shopKey = (master: string, businessId: string) => Buffer.from(hkdfSync('sha256', master, businessId, 'billing-erp backup v1', 32));

export function lockFile(master: string, header: Omit<FileHeader, 'app' | 'keyId'>, body: unknown): Buffer {
  const h = Buffer.from(JSON.stringify({ app: 'billing-erp', ...header, keyId: keyId(master) } satisfies FileHeader));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(h.length);
  const head = Buffer.concat([MAGIC, Buffer.from([VERSION]), len, h]);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', shopKey(master, header.business), iv);
  c.setAAD(head);
  const locked = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(body)))), c.final()]);
  return Buffer.concat([head, iv, c.getAuthTag(), locked]);
}

/** The readable header, without opening the file. */
export function readHeader(file: Buffer): { header: FileHeader; headEnd: number } {
  if (file.length < 11 || !file.subarray(0, 6).equals(MAGIC)) throw new BackupFileError('This isn’t a backup file from this app.');
  if (file[6] !== VERSION) throw new BackupFileError('This backup was made by a newer version of the app.');
  const n = file.readUInt32BE(7);
  if (file.length < 11 + n + 28) throw new BackupFileError('This backup file is cut short.');
  let header: FileHeader;
  try { header = JSON.parse(file.subarray(11, 11 + n).toString('utf8')) as FileHeader; } catch { throw new BackupFileError('This backup file is damaged.'); }
  if (header.app !== 'billing-erp') throw new BackupFileError('This isn’t a backup file from this app.');
  return { header, headEnd: 11 + n };
}

/** Opens a file for this shop; refuses another shop's file, another key, or any changed byte. */
export function openFile<T = unknown>(master: string, businessId: string, file: Buffer): { header: FileHeader; body: T } {
  const { header, headEnd } = readHeader(file);
  if (header.business !== businessId) throw new BackupFileError('This backup belongs to another shop.');
  if (header.keyId !== keyId(master)) throw new BackupFileError('This backup was locked with a different key.');
  const iv = file.subarray(headEnd, headEnd + 12);
  const tag = file.subarray(headEnd + 12, headEnd + 28);
  const d = createDecipheriv('aes-256-gcm', shopKey(master, businessId), iv);
  d.setAAD(file.subarray(0, headEnd));
  d.setAuthTag(tag);
  let plain: Buffer;
  try { plain = Buffer.concat([d.update(file.subarray(headEnd + 28)), d.final()]); } catch { throw new BackupFileError('This backup file is damaged or has been changed.'); }
  return { header, body: JSON.parse(gunzipSync(plain).toString('utf8')) as T };
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
