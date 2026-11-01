/**
 * Recovery codes (owner's request, 1 Nov 2026): ten one-time codes a person makes for their own account
 * (Settings › General › Recovery codes) and keeps safe. On the sign-in page, "Forgot password?" takes one
 * of them with the email and a new password. Only a hash of each code is stored.
 */
import { createHash, randomInt } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;
/** wrong codes in a row before the account's codes are refused for a while */
export const RECOVERY_MAX_TRIES = 5;
export const RECOVERY_WAIT_MINUTES = 15;

/** The temporary passwords' letters: no 0/O, 1/I/L. 8 characters ≈ 40 bits, guarded by the wait above. */
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** e.g. K7QM-4XPA */
export function makeRecoveryCode(): string {
  const c = Array.from({ length: 8 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** What the person typed, as stored: capitals, without spaces or dashes ("k7qm 4xpa" → "K7QM4XPA"). */
export const tidyRecoveryCode = (typed: string): string => typed.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The stored hash: per person, so the same code for two people never looks the same. */
export const hashRecoveryCode = (userId: string, typed: string): string =>
  createHash('sha256').update(`${userId}:${tidyRecoveryCode(typed)}`).digest('hex');
