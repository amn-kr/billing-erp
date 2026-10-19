import { describe, expect, it } from 'vitest';
import { bulkCellProblem, bulkItemsSchema, bulkSame, parseInrAmount, type BulkItemFacts } from '../src/bulk-items';

const fan: BulkItemFacts = { id: '6f1c2a34-1b2c-4d5e-8f90-a1b2c3d4e5f6', name: 'Ceiling fan', code: 'CF1', mrp: '2000.00' };
const codes = new Set(['led9', 'sw-6a']);

describe('parseInrAmount', () => {
  it('reads plain numbers and Indian grouping, at most 2 decimals', () => {
    expect(parseInrAmount('1250')).toBe('1250');
    expect(parseInrAmount('1,250')).toBe('1250');
    expect(parseInrAmount('1,25,000.50')).toBe('125000.50');
    expect(parseInrAmount('₹ 12,34,56,789')).toBe('123456789');
    expect(parseInrAmount('')).toBe('');
    expect(parseInrAmount('  ')).toBe('');
  });
  it('refuses other groupings, words and more than 2 decimals', () => {
    expect(parseInrAmount('125,000')).toBeNull(); // Indian grouping is 1,25,000
    expect(parseInrAmount('12,50,00')).toBeNull();
    expect(parseInrAmount('1,2500')).toBeNull();
    expect(parseInrAmount('12.345')).toBeNull();
    expect(parseInrAmount('ten')).toBeNull();
    expect(parseInrAmount('1.2.3')).toBeNull();
  });
});

describe('bulkCellProblem', () => {
  it('prices: numbers only, never below zero, sale not above MRP', () => {
    expect(bulkCellProblem('purchase', '1,560.50', fan, codes)).toBeNull();
    expect(bulkCellProblem('purchase', '', fan, codes)).toBeNull();
    expect(bulkCellProblem('purchase', '-5', fan, codes)).toBe('A price can’t be below zero.');
    expect(bulkCellProblem('purchase', '-1,250', fan, codes)).toBe('A price can’t be below zero.');
    expect(bulkCellProblem('sale', '12.345', fan, codes)).toBe('Use at most 2 decimals.');
    expect(bulkCellProblem('sale', 'abc', fan, codes)).toBe('Enter a number, like 1,25,000.50.');
    expect(bulkCellProblem('sale', '2,000', fan, codes)).toBeNull();
    expect(bulkCellProblem('sale', '2,000.01', fan, codes, (v) => `₹${v}`)).toBe('Sale price can’t be above MRP (₹2000.00).');
    expect(bulkCellProblem('sale', '5000', { ...fan, mrp: '0.00' }, codes)).toBeNull();
    expect(bulkCellProblem('sale', '10,00,00,00,00,000', fan, codes)).toBe('This price is too large.');
  });
  it('item code: unique in the shop ignoring capital letters, up to 60 characters', () => {
    expect(bulkCellProblem('code', 'LED9', fan, codes)).toBe('This item code is already used.');
    expect(bulkCellProblem('code', ' sw-6A ', fan, codes)).toBe('This item code is already used.');
    expect(bulkCellProblem('code', 'CF-NEW', fan, codes)).toBeNull();
    expect(bulkCellProblem('code', '', fan, codes)).toBeNull();
    expect(bulkCellProblem('code', 'x'.repeat(61), fan, codes)).toBe('An item code has up to 60 characters.');
  });
  it('tax slab and category', () => {
    expect(bulkCellProblem('gstRate', '18', fan, codes)).toBeNull();
    expect(bulkCellProblem('gstRate', '0', fan, codes)).toBeNull();
    expect(bulkCellProblem('gstRate', '', fan, codes)).toBe('Choose a tax slab.');
    expect(bulkCellProblem('gstRate', '120', fan, codes)).toBe('Choose a tax slab.');
    expect(bulkCellProblem('category', 'Fans', fan, codes)).toBeNull();
    expect(bulkCellProblem('category', 'c'.repeat(81), fan, codes)).toBe('A category name has up to 80 characters.');
  });
});

describe('bulkSame (only a real change counts)', () => {
  it('compares money as amounts, tax slabs as numbers, text trimmed', () => {
    expect(bulkSame('sale', '1250.00', '1,250')).toBe(true);
    expect(bulkSame('sale', '1250.00', '1250.5')).toBe(false);
    expect(bulkSame('purchase', '0.00', '')).toBe(true);
    expect(bulkSame('purchase', '10.00', 'abc')).toBe(false);
    expect(bulkSame('gstRate', '18.00', '18')).toBe(true);
    expect(bulkSame('gstRate', '18.00', '12')).toBe(false);
    expect(bulkSame('code', 'CF1', ' CF1 ')).toBe(true);
    expect(bulkSame('code', 'CF1', 'cf1')).toBe(false);
    expect(bulkSame('category', '', 'Fans')).toBe(false);
  });
});

describe('bulkItemsSchema', () => {
  const id2 = '7a1c2a34-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  it('takes only changed rows with known fields', () => {
    const r = bulkItemsSchema.parse({ rows: [{ id: fan.id, sale: '1,250.50' }, { id: id2, code: ' CF-2 ', gstRate: '12' }] });
    expect(r.rows).toEqual([{ id: fan.id, sale: '1250.50' }, { id: id2, code: 'CF-2', gstRate: 12 }]);
  });
  it('refuses an empty list, a row without changes, a negative price, a repeated item and a bad id', () => {
    const msg = (v: unknown) => bulkItemsSchema.safeParse(v).error?.issues.map((i) => i.message);
    expect(msg({ rows: [] })).toEqual(['Nothing has changed.']);
    expect(msg({ rows: [{ id: fan.id }] })).toEqual(['Each row needs at least one change.']);
    expect(msg({ rows: [{ id: fan.id, purchase: '-1' }] })).toEqual(['Enter a number.']);
    expect(msg({ rows: [{ id: fan.id, sale: '1' }, { id: fan.id, sale: '2' }] })).toEqual(['An item is listed twice.']);
    expect(msg({ rows: [{ id: '4826', sale: '1' }] })).toEqual(['That item was not found.']);
  });
});
