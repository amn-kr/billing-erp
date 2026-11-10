import { describe, expect, it } from 'vitest';
import { paperOf, pickPrinter, readChoice } from './paper';

describe('paperOf', () => {
  it('reads the paper and orientation the web app asks for', () => {
    expect(paperOf('A4 portrait')).toEqual({ pageSize: 'A4', landscape: false });
    expect(paperOf('A4 landscape')).toEqual({ pageSize: 'A4', landscape: true });
    expect(paperOf('A5 portrait')).toEqual({ pageSize: 'A5', landscape: false });
    expect(paperOf('A5 landscape')).toEqual({ pageSize: 'A5', landscape: true });
  });

  it('is A4 portrait when nothing (or something unknown) is asked for', () => {
    expect(paperOf(undefined)).toEqual({ pageSize: 'A4', landscape: false });
    expect(paperOf('')).toEqual({ pageSize: 'A4', landscape: false });
    expect(paperOf('Letter')).toEqual({ pageSize: 'A4', landscape: false });
    expect(paperOf({})).toEqual({ pageSize: 'A4', landscape: false });
  });
});

describe('pickPrinter', () => {
  const list = [
    { name: 'HP LaserJet', displayName: 'HP LaserJet' },
    { name: 'Canon LBP', displayName: 'Canon LBP' },
  ];
  it('uses the printer chosen on this PC', () => {
    expect(pickPrinter('Canon LBP', list)).toEqual({ ok: true, name: 'Canon LBP' });
  });
  it('says so when none is chosen (the print window opens instead)', () => {
    expect(pickPrinter(null, list)).toEqual({ ok: false, reason: 'none' });
    expect(pickPrinter('', list)).toEqual({ ok: false, reason: 'none' });
  });
  it('says so when the chosen printer is no longer connected', () => {
    expect(pickPrinter('Old Epson', list)).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('readChoice', () => {
  it('reads a saved printer name', () => {
    expect(readChoice({ printer: 'HP LaserJet' })).toBe('HP LaserJet');
  });
  it('ignores anything else', () => {
    expect(readChoice(null)).toBeNull();
    expect(readChoice({ printer: '' })).toBeNull();
    expect(readChoice({ printer: 5 })).toBeNull();
    expect(readChoice({ printer: 'x'.repeat(300) })).toBeNull();
    expect(readChoice('HP')).toBeNull();
  });
});
