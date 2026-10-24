import { describe, expect, it } from 'vitest';
import { checkImportRows, IMPORT_KEYS, parseImportDate, parseImportNumber, rowProblems, type ImportContext, type ImportRow } from '../src/item-import';

const ctx: ImportContext = {
  today: '2026-10-12',
  items: [
    { name: 'Bajaj fan', code: 'BJ1', group: '', brand: 'Bajaj', series: '' },
    { name: 'Switch · Havells Coral', code: 'HC1', group: 'Switch', brand: 'Havells', series: 'Coral' },
  ],
  brands: [{ name: 'Bajaj', active: true }, { name: 'Havells', active: true }, { name: 'Anchor', active: true }, { name: 'Old brand', active: false }],
  series: [{ brand: 'Anchor', name: 'Roma', active: true }, { brand: 'Anchor', name: 'Penta', active: false }],
  groups: ['Switch'],
  units: [{ code: 'PCS', name: 'Pieces' }, { code: 'BOX', name: '' }],
  godowns: [{ name: 'Main shop', isDefault: true }, { name: 'Back godown', isDefault: false }],
  categories: ['Fans', 'Lighting'],
  gstRates: ['0', '5', '18', '28'],
};
const row = (v: Partial<ImportRow>, line = 2): ImportRow => ({ line, ...Object.fromEntries(IMPORT_KEYS.map((k) => [k, ''])), ...v }) as ImportRow;
/** a complete, valid Single Range row: no problems at all */
const good = (v: Partial<ImportRow> = {}, line = 2) => row({ type: 'Single Range', name: 'Ceiling fan', brand: 'Bajaj', code: 'CF1', qty: '5', rate: '900', date: '01-04-2026', unit: 'PCS', sale: '1200', min: '2', godown: 'Main shop', category: 'Fans', gst: '18', hsn: '8414', ...v }, line);
const check = (rows: ImportRow[]) => checkImportRows(rows, ctx);
const one = (v: Partial<ImportRow>) => check([good(v)])[0]!;
const msgs = (v: Partial<ImportRow>, level?: 'error' | 'warning') => rowProblems(one(v), level);

describe('reading typed values', () => {
  it('dates: day first, as in India; Excel day numbers; nothing that is not a real date', () => {
    expect(parseImportDate('01-04-2026')).toBe('2026-04-01');
    expect(parseImportDate('1/4/2026')).toBe('2026-04-01');
    expect(parseImportDate('15.09.2026')).toBe('2026-09-15');
    expect(parseImportDate('15-Sep-2026')).toBe('2026-09-15');
    expect(parseImportDate('15 September 2026')).toBe('2026-09-15');
    expect(parseImportDate('2026-04-01')).toBe('2026-04-01');
    expect(parseImportDate('46113')).toBe('2026-04-01');
    for (const bad of ['31-02-2026', '13/13/2026', 'yesterday', '01-04-26', '2026/02/30', '15-Abc-2026']) expect(parseImportDate(bad), bad).toBeNull();
  });

  it('numbers: commas, ₹ and Rs. are fine; words are not', () => {
    expect(parseImportNumber('1,052.50')!.toString()).toBe('1052.5');
    expect(parseImportNumber('₹ 99')!.toString()).toBe('99');
    expect(parseImportNumber('Rs.12')!.toString()).toBe('12');
    expect(parseImportNumber('-5')!.toString()).toBe('-5');
    expect(parseImportNumber('')).toBeNull();
    expect(parseImportNumber('abc')).toBe('bad');
    expect(parseImportNumber('1.2.3')).toBe('bad');
  });
});

describe('import checks: a good row', () => {
  it('passes with nothing marked and cleaned values', () => {
    const c = one({});
    expect(c.status).toBe('ok');
    expect(c.cells).toEqual({});
    expect(c.item).toEqual({
      line: 2, kind: 'single', name: 'Ceiling fan', group: '', brand: 'Bajaj', series: '', code: 'CF1', qty: '5.000', rate: '900.00', date: '2026-04-01',
      unit: 'PCS', sale: '1200.00', minStock: '2.000', godown: 'Main shop', category: 'Fans', gst: '18', hsn: '8414',
      newBrand: false, newSeries: false, newGroup: false, newCategory: false,
    });
  });

  it('Multi Range: the item is named like Add item’s variant; names use the shop’s spelling', () => {
    const c = one({ type: 'multi range', name: 'switch', brand: 'ANCHOR', series: 'roma', code: 'AR1' });
    expect(c.status).toBe('ok');
    expect(c.item).toMatchObject({ kind: 'multi', name: 'Switch · Anchor Roma', group: 'Switch', brand: 'Anchor', series: 'Roma' });
  });

  it('unit by code or full name; godown, category and GST ignoring capitals', () => {
    expect(one({ unit: 'pieces', godown: 'BACK godown', category: 'fans', gst: '18%' }).item).toMatchObject({ unit: 'PCS', godown: 'Back godown', category: 'Fans', gst: '18' });
  });
});

describe('import checks: errors', () => {
  it('product type', () => {
    expect(msgs({ type: '' })).toEqual(['Product type: Choose Single Range or Multi Range.']);
    expect(msgs({ type: 'Double Range' })).toEqual(['Product type: “Double Range” is not a product type. Choose Single Range or Multi Range.']);
  });

  it('required columns: Single needs only the name; Multi also the brand and the series', () => {
    expect(msgs({ name: '', brand: '', code: '' }, 'error')).toEqual(['Product name: Enter the product name.']);
    expect(msgs({ type: 'Multi Range', name: 'Switch', brand: 'Anchor', series: '' }, 'error')).toEqual(['Series / range name: Enter the series / range name (needed for Multi Range).']);
    expect(msgs({ type: 'Multi Range', name: 'Switch', brand: '', series: 'Roma' }, 'error')).toEqual(['Brand name: Enter the brand name.']);
    expect(msgs({ type: 'Multi Range', name: 'Switch', brand: '', series: '' }, 'error')).toEqual(['Brand name: Enter the brand name.', 'Series / range name: Enter the series / range name (needed for Multi Range).']);
    // no product type: the brand is still asked for, as before
    expect(msgs({ type: '', brand: '' }, 'error')).toEqual(['Product type: Choose Single Range or Multi Range.', 'Brand name: Enter the brand name.']);
  });

  it('Single Range without a brand: nothing marked, saved with no brand, no new brand', () => {
    const c = one({ brand: '' });
    expect(c.status).toBe('ok');
    expect(c.item).toMatchObject({ kind: 'single', name: 'Ceiling fan', brand: '', series: '', newBrand: false });
  });

  it('Single Range: a series needs a brand', () => {
    const c = one({ brand: '', series: 'Coral' });
    expect(c.status).toBe('error');
    expect(c.item).toBeNull();
    expect(rowProblems(c)).toEqual(['Series / range name: Series needs a brand. Enter the brand name, or clear the series.']);
  });

  it('Single Range without a brand: the name must still be new in the shop and in the file', () => {
    expect(msgs({ name: 'bajaj FAN', brand: '' }, 'error')).toEqual(['Product name: An item called “Bajaj fan” already exists.']);
    const r = check([good({ brand: '', code: '' }, 2), good({ name: 'CEILING fan', brand: '', code: '' }, 3), good({ name: 'Ceiling fan', brand: 'Havells', code: '' }, 4)]);
    expect(r.map((c) => rowProblems(c, 'error'))).toEqual([
      ['Product name: This product name is also in row 3, 4 of the uploaded file.'],
      ['Product name: This product name is also in row 2, 4 of the uploaded file.'],
      ['Product name: This product name is also in row 2, 3 of the uploaded file.'],
    ]);
  });

  it('Single Range name already in the shop or twice in the file (both rows marked)', () => {
    expect(msgs({ name: 'BAJAJ FAN' }, 'error')).toEqual(['Product name: An item called “Bajaj fan” already exists.']);
    const r = check([good({}, 2), good({ name: 'ceiling FAN', code: 'CF2' }, 3), good({ name: 'Other', code: 'O1' }, 4)]);
    expect(r.map((c) => c.status)).toEqual(['error', 'error', 'ok']);
    expect(r[0]!.cells.name).toEqual([{ level: 'error', message: 'This product name is also in row 3 of the uploaded file.' }]);
    expect(r[1]!.cells.name).toEqual([{ level: 'error', message: 'This product name is also in row 2 of the uploaded file.' }]);
  });

  it('Multi Range: the same product name may repeat; product + brand + series may not', () => {
    const m = (series: string, code: string, line: number, brand = 'Anchor') => good({ type: 'Multi Range', name: 'Switch', brand, series, code }, line);
    expect(check([m('Roma', 'A1', 2), m('Penta', 'A2', 3)]).map((c) => c.status)).toEqual(['ok', 'warning']);
    expect(check([m('Coral', 'H1', 2, 'Havells')])[0]!.cells.series).toEqual([{ level: 'error', message: 'Havells Coral is already in Switch (item “Switch · Havells Coral”).' }]);
    const r = check([m('Roma', 'A1', 2), m('ROMA', 'A2', 3)]);
    expect(r.map((c) => rowProblems(c, 'error'))).toEqual([
      ['Series / range name: This product, brand and series is also in row 3 of the uploaded file.'],
      ['Series / range name: This product, brand and series is also in row 2 of the uploaded file.'],
    ]);
  });

  it('a Single Range name that a Multi Range row of the file also makes', () => {
    const r = check([good({ type: 'Multi Range', name: 'Switch', brand: 'Anchor', series: 'Roma', code: 'A1' }, 2), good({ name: 'switch · anchor roma', code: 'X' }, 3)]);
    expect(r[1]!.cells.name).toEqual([{ level: 'error', message: 'Row 2 makes an item with this same name.' }]);
  });

  it('brand code is optional: a blank code is no problem, and blank codes never count as the same code', () => {
    const c = one({ code: '' });
    expect(c.status).toBe('ok');
    expect(c.item!.code).toBe('');
    const r = check([good({ code: '' }, 2), good({ name: 'Other fan', code: '' }, 3), good({ type: 'Multi Range', name: 'Switch', brand: 'Anchor', series: 'Roma', code: '' }, 4)]);
    expect(r.map((x) => x.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('brand code used by an item or twice in the file', () => {
    expect(msgs({ code: 'hc1' }, 'error')).toEqual(['Brand code: Brand code hc1 is already used by “Switch · Havells Coral”.']);
    const r = check([good({}, 2), good({ name: 'B' }, 3), good({ name: 'C' }, 4), good({ name: 'D' }, 5), good({ name: 'E' }, 6), good({ name: 'F', code: 'cf1' }, 7)]);
    expect(r[0]!.cells.code![0]!.message).toBe('This brand code is also in row 3, 4, 5 and 2 more of the uploaded file.');
  });

  it('numbers: not a number, negative, too large', () => {
    expect(msgs({ qty: 'ten' }, 'error')).toEqual(['Opening stock: Opening stock must be a number.']);
    expect(msgs({ rate: '-1' }, 'error')).toEqual(['At price: At price cannot be negative.']);
    expect(msgs({ sale: '1000000000000' }, 'error')).toEqual(['Sale price: Sale price is too large.']);
    expect(msgs({ min: '-2' }, 'error')).toEqual(['Stock alert: Stock alert cannot be negative.']);
  });

  it('dates: unreadable, in the future, too old', () => {
    expect(msgs({ date: '31-02-2026' }, 'error')).toEqual(['As of date: “31-02-2026” is not a date. Type it like 01-04-2026.']);
    expect(msgs({ date: '13-10-2026' }, 'error')).toEqual(['As of date: The date 13-10-2026 is in the future.']);
    expect(msgs({ date: '12-10-2026' }, 'error')).toEqual([]);
    expect(msgs({ date: '01-01-1999' }, 'error')).toEqual(['As of date: The date 01-01-1999 looks wrong.']);
  });

  it('opening stock needs its rate (0 is allowed)', () => {
    expect(msgs({ rate: '' }, 'error')).toEqual(['At price: Enter the rate of the opening stock (0 if it cost nothing).']);
    expect(one({ rate: '0' }).status).toBe('warning');
  });

  it('unit, godown and GST must be in the shop’s lists; HSN 4 to 8 digits', () => {
    expect(msgs({ unit: 'DOZEN' }, 'error')).toEqual(['Base unit: Unit “DOZEN” is not in your units. Choose one from the list.']);
    expect(msgs({ godown: 'Shop 2' }, 'error')).toEqual(['Location: There is no godown called “Shop 2”. Choose one from the list.']);
    expect(msgs({ gst: '15' }, 'error')).toEqual(['GST %: 15% is not a GST rate in your tax list.']);
    expect(msgs({ gst: 'abc' }, 'error')).toEqual(['GST %: abc% is not a GST rate in your tax list.']);
    expect(msgs({ hsn: '12AB' }, 'error')).toEqual(['HSN: HSN is 4 to 8 digits.']);
    expect(msgs({ hsn: '123' }, 'error')).toEqual(['HSN: HSN is 4 to 8 digits.']);
  });

  it('text too long', () => {
    expect(msgs({ name: 'x'.repeat(201) }, 'error')).toEqual(['Product name: The product name is too long (at most 200 letters).']);
    expect(msgs({ code: 'x'.repeat(61) }, 'error')).toEqual(['Brand code: The brand code is too long (at most 60 letters).']);
  });

  it('a row with an error gives nothing to save', () => {
    expect(one({ unit: 'DOZEN' }).item).toBeNull();
  });
});

describe('import checks: warnings (the row can still be imported)', () => {
  const w = (v: Partial<ImportRow>) => { const c = one(v); expect(c.status).toBe('warning'); return rowProblems(c, 'warning'); };

  it('new brand, series, parent item and category will be created', () => {
    expect(w({ brand: 'Polycab' })).toEqual(['Brand name: New brand “Polycab” will be created.']);
    expect(w({ type: 'Multi Range', name: 'Wire', brand: 'Anchor', series: 'Roma' })).toEqual(['Product name: New parent item “Wire” will be created.']);
    expect(w({ type: 'Multi Range', name: 'Switch', brand: 'Anchor', series: 'Zenit' })).toEqual(['Series / range name: New series “Zenit” for Anchor will be created.']);
    expect(w({ category: 'Solar' })).toEqual(['Category: New category “Solar” will be created.']);
    expect(one({ brand: 'Polycab', category: 'Solar' }).item).toMatchObject({ newBrand: true, newCategory: true });
  });

  it('inactive brand or series', () => {
    expect(w({ brand: 'old BRAND' })).toEqual(['Brand name: Brand “Old brand” is inactive on Brands & Series. The item will still be added.']);
    expect(w({ type: 'Multi Range', name: 'Switch', brand: 'Anchor', series: 'penta' })).toEqual(['Series / range name: Series “Penta” is inactive on Brands & Series. The item will still be added.']);
  });

  it('sale price blank or below the At price', () => {
    expect(w({ sale: '' })).toEqual(['Sale price: No sale price: it will be saved as 0.']);
    expect(w({ sale: '800' })).toEqual(['Sale price: Sale price is lower than the At price (900.00).']);
  });

  it('dates: blank with stock → today; given without stock → ignored', () => {
    expect(w({ date: '' })).toEqual(['As of date: No date: today (12-10-2026) will be used.']);
    expect(one({ date: '' }).item).toMatchObject({ date: '2026-10-12' });
    expect(w({ qty: '' })).toEqual(['As of date: There is no opening stock, so this date will be ignored.']);
    expect(one({ qty: '0' }).item).toMatchObject({ qty: null, date: null, rate: '900.00' });
  });

  it('At price 0, GST blank (18%), series on a Single Range row', () => {
    expect(w({ rate: '0', sale: '10' })).toEqual(['At price: At price is 0, so this stock will have no value.']);
    expect(w({ gst: '' })).toEqual(['GST %: No GST rate: 18% will be used.']);
    expect(one({ gst: '' }).item!.gst).toBe('18');
    expect(w({ series: 'Coral' })).toEqual(['Series / range name: Series is only used for Multi Range. It will be ignored.']);
    expect(one({ series: 'Coral' }).item!.series).toBe('');
  });

  it('rounding: money to 2 decimals, quantities to 3', () => {
    expect(w({ rate: '10.555', sale: '20' })).toEqual(['At price: At price will be rounded to 10.56.']);
    expect(w({ qty: '1.23456' })).toEqual(['Opening stock: Opening stock will be rounded to 1.235.']);
    expect(one({ rate: '10.555', sale: '20' }).item!.rate).toBe('10.56');
  });

  it('a new name typed with other capitals on later rows uses the first row’s spelling', () => {
    const r = check([good({ brand: 'Polycab', code: 'P1', name: 'A' }, 2), good({ brand: 'POLYCAB', code: 'P2', name: 'B' }, 3)]);
    expect(r.map((c) => c.item!.brand)).toEqual(['Polycab', 'Polycab']);
  });
});
