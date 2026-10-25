/**
 * Temporary passwords (Settings › General › Team › Reset password, and the support reset script).
 * Shown once to whoever made it and never stored: only its hash is kept. It works for 48 hours and
 * only to choose a new password; every other sign-in of that person ends at once.
 */
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { hashPassword } from '../auth/password';

export const TEMP_PASSWORD_HOURS = 48;

/** No 0/O, 1/I/L: easy to read out loud and type. 12 characters ≈ 59 bits. */
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** e.g. K7MP-4XQ2-9RTD */
export function makeTempPassword(): string {
  const c = Array.from({ length: 12 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** The parts of a Prisma client or transaction this needs. */
type Db = Pick<Prisma.TransactionClient, 'user' | 'session' | 'passwordReset'>;

/** Sets a new temporary password for this person, signs them out everywhere and cancels open reset links. */
export async function issueTempPassword(db: Db, userId: string, now = new Date()): Promise<{ temporaryPassword: string; expiresAt: Date }> {
  const temporaryPassword = makeTempPassword();
  const expiresAt = new Date(now.getTime() + TEMP_PASSWORD_HOURS * 3_600_000);
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, tempPasswordExpiresAt: expiresAt } });
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await db.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  return { temporaryPassword, expiresAt };
}
