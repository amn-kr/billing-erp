import { describe, expect, it } from 'vitest';
import {
  checkPartyRows, gstinProblem, PARTY_EXAMPLE_ROW, headerColumns, parsePartyAmount, partyColumnOf, partyImportSchema, partyRowProblems, PARTY_IMPORT_KEYS,
  readPasted, splitPasted, stateCodeOf, type PartyImportContext, type PartyImportRow,
} from '../src/party-import';

/** made-up GSTINs with a correct check digit (27 = Maharashtra, 09 = Uttar Pradesh) */
const G27 = '27ABCDE1234F1Z0';
const G09 = '09AAJPM7745Q1ZP';

const ctx: PartyImportContext = { parties: [{ name: 'Mehta Electricals', phone: '9876543210' }, { name: 'Walk-in', phone: '' }], gst: true };
const row = (v: Partial<PartyImportRow>, line = 2): PartyImportRow => ({ line, ...Object.fromEntries(PARTY_IMPORT_KEYS.map((k) => [k, ''])), ...v }) as PartyImportRow;
const good = (v: Partial<PartyImportRow> = {}, line = 2) =>
  row({ name: 'Sharma Traders', type: 'Customer', phone: '9123456780', email: 'a@b.in', gstin: G27, address: 'Shop 4, MG Road', city: 'Pune', state: 'Maharashtra', opening: '2500.50', balType: 'To receive', limit: '50000', ...v }, line);
const one = (v: Partial<PartyImportRow>, c = ctx) => checkPartyRows([good(v)], c)[0]!;
const why = (v: Partial<PartyImportRow>) => partyRowProblems(one(v));

describe('GSTIN', () => {
  it('a GSTIN with the right pattern and check digit passes', () => {
    expect(gstinProblem(G27)).toBeNull();
    expect(gstinProblem(G09)).toBeNull();
    expect(one({}).status).toBe('ok');
  });
  it('a wrong check digit, a wrong pattern or an unknown state code rejects the row', () => {
    expect(gstinProblem('27ABCDE1234F1Z1')).toMatch(/last character does not match/);
    expect(gstinProblem('27ABCDE1234F1')).toMatch(/15 characters/);
    expect(gstinProblem('99ABCDE1234F1Z0')).toMatch(/not a state code/);
    const c = one({ gstin: '27ABCDE1234F1Z1' });
    expect(c.status).toBe('rejected');
    expect(c.party).toBeNull();
    expect(why({ gstin: '27ABCDE1234F1Z1' })).toEqual(['GSTIN: This GSTIN is not valid: its last character does not match. Check it for a typing mistake.']);
  });
  it('lower case and spaces are fine; a blank state is taken from the GSTIN; a different state rejects', () => {
    expect(one({ gstin: ' 27abcde1234f1z0 ' }).party!.gstin).toBe(G27);
    expect(one({ state: '' }).party!.state).toBe('27');
    expect(why({ state: 'Gujarat' })).toEqual(['GSTIN: GSTIN starts with 27 (Maharashtra), but the state is Gujarat.']);
  });
  it('no GSTIN: no GST type when GST is off; unregistered when on', () => {
    expect(one({ gstin: '' }).party!.gstType).toBe('Unregistered / consumer');
    expect(one({}).party!.gstType).toBe('Registered business – regular');
    expect(one({}, { ...ctx, gst: false }).party!.gstType).toBe('');
  });
});

describe('amounts', () => {
  it('0, 1 or 2 decimals are fine; 3 decimals, negatives and words are rejected', () => {
    expect(parsePartyAmount('2500')).toEqual({ value: '2500.00' });
    expect(parsePartyAmount('2500.5')).toEqual({ value: '2500.50' });
    expect(parsePartyAmount('₹ 2,500.55')).toEqual({ value: '2500.55' });
    expect(parsePartyAmount('2500.500')).toEqual({ value: '2500.50' });
    expect(parsePartyAmount('2500.555')).toEqual({ error: 'At most 2 decimals (paise).' });
    expect(parsePartyAmount('-10')).toEqual({ error: 'Cannot be negative.' });
    expect(parsePartyAmount('ten')).toEqual({ error: 'Enter a number, like 2500 or 2500.50.' });
    expect(parsePartyAmount('')).toEqual({ value: null });
    expect(why({ opening: '10.123' })).toEqual(['Opening balance: At most 2 decimals (paise).']);
    expect(why({ limit: '-1' })).toEqual(['Credit limit: Cannot be negative.']);
  });
  it('the saved amounts are exact strings, never floats', () => {
    const p = one({ opening: '0.10', limit: '1,00,000' }).party!;
    expect(p.openingBalance).toBe('0.10');
    expect(p.creditLimit).toBe('100000.00');
    expect(one({ limit: '' }).party!.creditLimit).toBeNull();
  });
});

describe('balance type and party type', () => {
  it('To receive, To collect and To pay; needed only when there is an opening balance', () => {
    expect(one({ balType: 'to receive' }).party!.openingType).toBe('receive');
    expect(one({ balType: 'To Collect' }).party!.openingType).toBe('receive');
    expect(one({ balType: 'TO PAY' }).party!.openingType).toBe('pay');
    expect(why({ balType: '' })).toEqual(['Balance type: Choose To receive or To pay for the opening balance.']);
    expect(why({ balType: 'Credit' })).toEqual(['Balance type: Choose To receive or To pay.']);
    expect(one({ opening: '', balType: '' }).status).toBe('ok');
    expect(one({ opening: '0', balType: '' }).party!.openingBalance).toBeNull();
  });
  it('Customer or Supplier (blank = Customer); Both is rejected with a clear reason', () => {
    expect(one({ type: '' }).party!.kind).toBe('customer');
    expect(one({ type: 'supplier' }).party!.kind).toBe('supplier');
    expect(why({ type: 'Both' })).toEqual(['Party type: This app has no “Both” party type yet. Choose Customer or Supplier.']);
    expect(why({ type: 'Vendor' })).toEqual(['Party type: Choose Customer or Supplier.']);
  });
  it('no opening balance: the balance type is the one Add party picks for the kind', () => {
    expect(one({ type: 'Supplier', opening: '', balType: '' }).party!.openingType).toBe('pay');
  });
});

describe('other fields', () => {
  it('name required; phone as Add party (10-digit mobile, +91 and spaces removed); email; state by name or code', () => {
    expect(why({ name: '  ' })).toEqual(['Party name: Enter the party name.']);
    expect(one({ phone: '+91 91234 56780' }).party!.phone).toBe('9123456780');
    expect(why({ phone: '12345' })).toEqual(['Phone: Enter a 10-digit mobile number.']);
    expect(why({ email: 'not-an-email' })).toEqual(['Email: Enter a valid email address.']);
    expect(stateCodeOf('maharashtra')).toBe('27');
    expect(stateCodeOf('9')).toBe('09');
    expect(stateCodeOf('Jammu and Kashmir')).toBe('01');
    expect(stateCodeOf('Atlantis')).toBeNull();
    expect(why({ gstin: '', state: 'Atlantis' })).toEqual(['State: Choose a state from the list, e.g. Maharashtra.']);
  });
  it('an OK row becomes what Add party sends: General group, address line and city', () => {
    expect(one({}).party).toMatchObject({ name: 'Sharma Traders', group: 'General', billing: { line: 'Shop 4, MG Road', city: 'Pune', pin: '', state: '' }, state: '27', email: 'a@b.in' });
  });
  it('blank rows are left out', () => {
    expect(checkPartyRows([row({}, 2), good({}, 3), row({ city: '  ' }, 4)], ctx).map((c) => c.line)).toEqual([3]);
  });
});

describe('duplicates', () => {
  it('a name or phone the shop already has is skipped (any capital letters), never updated', () => {
    const c = one({ name: 'mehta  electricals', phone: '' });
    expect(c.status).toBe('duplicate');
    expect(c.party).toBeNull();
    expect(partyRowProblems(c)).toEqual(['A party named “Mehta Electricals” already exists.']);
    expect(partyRowProblems(one({ phone: '98765 43210' }))).toEqual(['Phone 9876543210 is already used by “Mehta Electricals”.']);
  });
  it('inside one batch: the first row is kept, later copies skipped; a rejected row does not count', () => {
    const cs = checkPartyRows([
      good({ gstin: 'BAD' }, 2),
      good({}, 3),
      good({ phone: '' }, 4),
      good({ name: 'Other', gstin: '' }, 5),
    ], ctx);
    expect(cs.map((c) => c.status)).toEqual(['rejected', 'ok', 'duplicate', 'duplicate']);
    expect(partyRowProblems(cs[2]!)).toEqual(['Same party name as row 3.']);
    expect(partyRowProblems(cs[3]!)).toEqual(['Same phone as row 3.']);
  });
  it('a row with a wrong value is Rejected, not Duplicate', () => {
    expect(one({ name: 'Mehta Electricals', gstin: 'BAD' }).status).toBe('rejected');
  });
});

describe('the sample file’s example row', () => {
  it('left in the file, it is skipped as an example row: not rejected, not a duplicate, never saved', () => {
    const [c] = checkPartyRows([row(PARTY_EXAMPLE_ROW, 2)], ctx);
    expect(c).toEqual({ line: 2, status: 'example', cells: { row: ['The example row from the sample file. Replace it with your own parties.'] }, party: null });
    // even as Excel gives it back (amounts as numbers, other capital letters, spaces in the phone)
    expect(checkPartyRows([row({ ...PARTY_EXAMPLE_ROW, name: 'EXAMPLE TRADERS', phone: '98765 00000', opening: '2500' }, 2)], ctx)[0]!.status).toBe('example');
  });
  it('it does not make a later row a duplicate; a real party that only shares the name is checked as usual', () => {
    const cs = checkPartyRows([row(PARTY_EXAMPLE_ROW, 2), good({ name: 'Example Traders', phone: '9123400009', gstin: '' }, 3)], ctx);
    expect(cs.map((c) => c.status)).toEqual(['example', 'ok']);
  });
});

describe('pasted text and headings', () => {
  it('splits tabs and new lines, keeps quoted cells, drops trailing empty lines', () => {
    expect(splitPasted('a\tb\r\nc\t"d\te"\n"x ""y"""\t\n\n')).toEqual([['a', 'b'], ['c', 'd\te'], ['x "y"', '']]);
    expect(splitPasted('"line1\nline2"\tz')).toEqual([['line1\nline2', 'z']]);
    // a CSV file: commas, quotes around a cell with a comma, Excel's BOM at the start
    expect(splitPasted('\uFEFFParty name,City\r\n"Shop 4, MG Road",Pune\r\n', ',')).toEqual([['Party name', 'City'], ['Shop 4, MG Road', 'Pune']]);
  });
  it('headings match ignoring case and extra spaces (and a required star)', () => {
    expect(partyColumnOf('  PARTY   name * ')).toBe('name');
    expect(partyColumnOf('Mobile')).toBe('phone');
    expect(partyColumnOf('Something else')).toBe('');
  });
  it('a heading row is found and left out; its order is used', () => {
    const p = readPasted('Phone\tParty name\tNotes\n9123456780\tSharma Traders\thello\n');
    expect(p.header).toBe(true);
    expect(p.cells).toEqual([{ phone: '9123456780', name: 'Sharma Traders' }]);
  });
  it('rows of data are not mistaken for headings', () => {
    expect(headerColumns(['Sharma Traders', 'Customer', '9123456780'])).toBeNull();
    // one heading-like word is not enough
    expect(headerColumns(['City', 'Pune'])).toBeNull();
    const p = readPasted('Sharma Traders\tCustomer\nGupta Stores\tSupplier');
    expect(p).toEqual({ header: false, cells: [['Sharma Traders', 'Customer'], ['Gupta Stores', 'Supplier']] });
  });
});

describe('the batch limit', () => {
  it('1000 rows are accepted, 1001 refused', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => good({ name: `P${i}` }, i + 2));
    expect(partyImportSchema.safeParse({ rows: rows(1000) }).success).toBe(true);
    const r = partyImportSchema.safeParse({ rows: rows(1001) });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toMatch(/At most 1,000 parties/);
  });
});
