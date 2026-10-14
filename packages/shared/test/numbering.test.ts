import { describe, expect, it } from 'vitest';
import { counterOf, formatNumber, PREFIX_RE, prefixesClash, prefixPattern } from '../src/numbering';

describe('document prefixes', () => {
  it('allows letters, digits, / - _ and up to 10 characters (empty = None)', () => {
    for (const ok of ['', 'JE/INV/', 'INV-', 'A_1', 'ABCDEFGHIJ']) expect(PREFIX_RE.test(ok)).toBe(true);
    for (const bad of ['ABCDEFGHIJK', 'JE INV', 'JE.INV', 'INV#', 'ए']) expect(PREFIX_RE.test(bad)).toBe(false);
  });

  it('formats the next number with four digits', () => {
    expect(formatNumber('JE/INV/', 1)).toBe('JE/INV/0001');
    expect(formatNumber('', 34)).toBe('0034');
    expect(formatNumber('INV-', 12345)).toBe('INV-12345');
  });

  it('reads the counter back only when the rest is digits', () => {
    expect(counterOf('JE/INV/0413', 'JE/INV/')).toBe(413);
    expect(counterOf('JE/INV/0413', 'JE/')).toBeNull();
    expect(counterOf('0034', '')).toBe(34);
    expect(counterOf('INV-0001', '')).toBeNull();
  });

  it('refuses two prefixes that could make the same number', () => {
    expect(prefixesClash('A', 'A1')).toBe(true);
    expect(prefixesClash('', '12')).toBe(true);
    expect(prefixesClash('inv-', 'INV-')).toBe(true);
    expect(prefixesClash('JE/', 'JE/INV/')).toBe(false);
    expect(prefixesClash('', 'INV-')).toBe(false);
    expect(prefixesClash('INV-', 'INV-2')).toBe(true);
    expect(prefixesClash('INV-', 'INV-A')).toBe(false);
  });

  it('matches numbers made with a prefix (as Postgres ~ does)', () => {
    const re = (p: string) => new RegExp(prefixPattern(p));
    expect(re('JE/INV/').test('JE/INV/0001')).toBe(true);
    expect(re('JE/').test('JE/INV/0001')).toBe(false);
    expect(re('').test('0034')).toBe(true);
    expect(re('').test('INV-0034')).toBe(false);
  });
});
