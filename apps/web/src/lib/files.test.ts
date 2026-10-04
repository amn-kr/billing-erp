import { describe, expect, it } from 'vitest';
import { readCsv } from './files';

describe('readCsv (Price manager › Import Excel)', () => {
  it('reads quoted cells, doubled quotes and both line endings', () => {
    expect(readCsv('Item code,Item,Retail\r\nCW15,"Copper wire 1.5 sq mm (90 m)","1,890"\nLB9,"LED ""bulb"" 9W",95\n')).toEqual([
      ['Item code', 'Item', 'Retail'],
      ['CW15', 'Copper wire 1.5 sq mm (90 m)', '1,890'],
      ['LB9', 'LED "bulb" 9W', '95'],
    ]);
  });
  it('keeps empty cells and a last line without a newline', () => {
    expect(readCsv('a,,c\nx,y')).toEqual([['a', '', 'c'], ['x', 'y']]);
  });
});
