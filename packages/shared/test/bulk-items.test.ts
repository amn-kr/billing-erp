import { describe, expect, it } from 'vitest';
import { bulkCellProblem, bulkItemsSchema, bulkSame } from '../src/bulk-items';

const codes = new Set(['led9', 'sw-6a']);
const rates = ['0', '5', '12', '18', '28'];

describe('bulkCellProblem', () => {
  it('item code: unique in the shop ignoring capital letters, up to 60 characters', () => {
    expect(bulkCellProblem('code', 'LED9', codes, rates)).toBe('Used by another item.');
    expect(bulkCellProblem('code', ' sw-6A ', codes, rates)).toBe('Used by another item.');
    expect(bulkCellProblem('code', 'CF-NEW', codes, rates)).toBeNull();
    expect(bulkCellProblem('code', '', codes, rates)).toBeNull();
    expect(bulkCellProblem('code', 'x'.repeat(61), codes, rates)).toBe('Up to 60 characters.');
  });
  it('tax slab: one of the shop’s slabs', () => {
    expect(bulkCellProblem('gstRate', '18', codes, rates)).toBeNull();
    expect(bulkCellProblem('gstRate', '0', codes, rates)).toBeNull();
    expect(bulkCellProblem('gstRate', '', codes, rates)).toBe('Choose a tax slab.');
    expect(bulkCellProblem('gstRate', '7', codes, rates)).toBe('Choose a tax slab.');
  });
  it('category and description lengths', () => {
    expect(bulkCellProblem('category', 'Fans', codes, rates)).toBeNull();
    expect(bulkCellProblem('category', 'c'.repeat(81), codes, rates)).toBe('Up to 80 characters.');
    expect(bulkCellProblem('description', 'd'.repeat(500), codes, rates)).toBeNull();
    expect(bulkCellProblem('description', 'd'.repeat(501), codes, rates)).toBe('Up to 500 characters.');
  });
});

describe('bulkSame (only a real change counts)', () => {
  it('compares tax slabs as numbers and text trimmed', () => {
    expect(bulkSame('gstRate', '18.00', '18')).toBe(true);
    expect(bulkSame('gstRate', '18.00', '12')).toBe(false);
    expect(bulkSame('code', 'CF1', ' CF1 ')).toBe(true);
    expect(bulkSame('code', 'CF1', 'cf1')).toBe(false);
    expect(bulkSame('category', '', 'Fans')).toBe(false);
    expect(bulkSame('description', 'Copper', 'Copper ')).toBe(true);
  });
});

describe('bulkItemsSchema', () => {
  const id1 = '6f1c2a34-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const id2 = '7a1c2a34-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const msg = (v: unknown) => bulkItemsSchema.safeParse(v).error?.issues.map((i) => i.message);
  it('takes only changed rows with the four fields', () => {
    const r = bulkItemsSchema.parse({ rows: [{ id: id1, description: ' 1200 mm sweep ' }, { id: id2, code: ' CF-2 ', gstRate: '12', category: 'Fans' }] });
    expect(r.rows).toEqual([{ id: id1, description: '1200 mm sweep' }, { id: id2, code: 'CF-2', gstRate: 12, category: 'Fans' }]);
  });
  it('refuses prices and any other field', () => {
    const no = 'Only category, item code, description and tax slab can be changed here. Prices are changed in Price manager.';
    // the first message is the one the screen and the API answer show
    expect(msg({ rows: [{ id: id1, sale: '100' }] })?.[0]).toBe(no);
    expect(msg({ rows: [{ id: id1, code: 'A1', purchase: '100' }] })).toEqual([no]);
    expect(msg({ rows: [{ id: id1, openingQty: '5' }] })?.[0]).toBe(no);
  });
  it('refuses an empty list, a row without changes, a repeated item, a bad tax slab and a bad id', () => {
    expect(msg({ rows: [] })).toEqual(['Nothing has changed.']);
    expect(msg({ rows: [{ id: id1 }] })).toEqual(['Each row needs at least one change.']);
    expect(msg({ rows: [{ id: id1, code: 'A' }, { id: id1, code: 'B' }] })).toEqual(['An item is listed twice.']);
    expect(msg({ rows: [{ id: id1, gstRate: 120 }] })?.length).toBe(1);
    expect(msg({ rows: [{ id: 'not-an-id', code: 'A' }] })).toEqual(['That item was not found.']);
  });
});
