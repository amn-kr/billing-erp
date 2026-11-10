/**
 * The recovery key: locks the backups this PC makes (the API's BACKUP_MASTER_KEY) and opens them on
 * any other computer. Made once per PC; the owner prints it (Settings › Backup & restore).
 * 32 characters from A–Z and 2–7 (160 random bits), shown as 8 groups of 4: "ABCD-EFGH-…".
 * The API reads a typed key forgivingly (folder.ts normaliseKey): small letters, spaces and dashes
 * don't matter, and 0 / 1 / 8 (never used) are read as O / I / B.
 */
import crypto from 'node:crypto';

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function makeKey(): string {
  const bytes = crypto.randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ABC[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

export const formatKey = (key: string) => key.match(/.{1,4}/g)!.join('-');
