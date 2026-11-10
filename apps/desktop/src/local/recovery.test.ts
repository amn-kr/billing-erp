import { describe, expect, it } from 'vitest';
import { formatKey, makeKey } from './recovery';

describe('the recovery key', () => {
  it('is 32 characters from A–Z and 2–7 (never 0, 1, 8 or 9, which look like letters)', () => {
    for (let i = 0; i < 50; i++) expect(makeKey()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('is different on every PC', () => {
    expect(new Set(Array.from({ length: 100 }, makeKey)).size).toBe(100);
  });
  it('is shown in 8 groups of 4', () => {
    expect(formatKey('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')).toBe('ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567');
  });
});
