import { describe, expect, it } from 'vitest';
import { BackupFileError, lockFile, openFile, readHeader } from '../src/modules/backup/crypto';
import { chainAfter, remapIds, replay, summarise, type Books, type Row } from '../src/modules/backup/restore';
import type { TableInfo } from '../src/modules/backup/tables';

/** Backup files (locking, opening) and rebuilding books from a full copy + later changes — no database. */
const KEY = 'unit-test-master-key-0123456789abcdefghij';
const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const head = { business: SHOP, kind: 'changes' as const, afterSeq: '4', toSeq: '9', createdAt: '2026-10-12T08:30:00.000Z' };

describe('backup file lock', () => {
  it('opens what it locked, with a readable header', () => {
    const f = lockFile(KEY, head, { changes: [{ s: '5', t: 'parties', o: 'I', d: { id: 'p1', name: 'Verma Traders' } }] });
    expect(f.subarray(0, 6).toString()).toBe('BERPBK');
    expect(readHeader(f).header).toMatchObject({ app: 'billing-erp', business: SHOP, afterSeq: '4', toSeq: '9' });
    // the shop's data is not readable in the file
    expect(f.includes(Buffer.from('Verma'))).toBe(false);
    expect(openFile(KEY, SHOP, f).body).toEqual({ changes: [{ s: '5', t: 'parties', o: 'I', d: { id: 'p1', name: 'Verma Traders' } }] });
  });

  it('refuses another shop, another key, a changed byte or a relabelled header', () => {
    const f = lockFile(KEY, head, { changes: [] });
    expect(() => openFile(KEY, OTHER, f)).toThrow('This backup belongs to another shop.');
    expect(() => openFile(KEY + 'x', SHOP, f)).toThrow('This backup was locked with a different key.');
    const bad = Buffer.from(f);
    bad[bad.length - 3]! ^= 1;
    expect(() => openFile(KEY, SHOP, bad)).toThrow('This backup file is damaged or has been changed.');
    // same length header, different numbers: the seal no longer matches
    const relabelled = Buffer.from(f.toString('latin1').replace('"toSeq":"9"', '"toSeq":"8"'), 'latin1');
    expect(() => openFile(KEY, SHOP, relabelled)).toThrow(BackupFileError);
    expect(() => readHeader(Buffer.from('hello'))).toThrow('This isn’t a backup file from this app.');
  });

  it('locks the same content differently each time', () => {
    expect(lockFile(KEY, head, { a: 1 }).equals(lockFile(KEY, head, { a: 1 }))).toBe(false);
  });
});

describe('which change files a restore needs', () => {
  const f = (a: number, b: number) => ({ afterSeq: BigInt(a), toSeq: BigInt(b) });
  it('takes the files after the full copy, in order', () => {
    const r = chainAfter(10n, [f(12, 20), f(0, 5), f(5, 12), f(20, 21)]);
    expect('files' in r && r.files).toEqual([f(5, 12), f(12, 20), f(20, 21)]);
  });
  it('reports a missing piece', () => {
    expect(chainAfter(10n, [f(5, 12), f(13, 20)])).toEqual({ gap: 'Changes 13 to 13 are missing from this backup.' });
    expect(chainAfter(10n, [f(11, 20)])).toEqual({ gap: 'Changes 11 to 11 are missing from this backup.' });
  });
  it('needs nothing when the full copy is the latest', () => {
    expect(chainAfter(10n, [f(0, 10)])).toEqual({ files: [] });
  });
});

const T = (name: string, pk = ['id']): TableInfo => ({ name, shopCol: name === 'businesses' ? 'id' : 'business_id', pk, columns: [], deps: [] });
const TABLES = [T('businesses'), T('parties'), T('sales_documents'), T('business_settings', ['business_id'])];

describe('rebuilding the books', () => {
  const snap = {
    tables: {
      businesses: [{ id: SHOP, name: 'Sharma Electricals' }],
      parties: [{ id: 'p1', business_id: SHOP, name: 'Verma' }, { id: 'p2', business_id: SHOP, name: 'Gone soon' }],
      sales_documents: [],
      old_table_no_longer_there: [{ id: 'x' }],
    },
  };
  it('applies later changes in order and skips those already in the full copy', () => {
    const { books, applied, lastAt } = replay(TABLES, snap, 3n, [
      { changes: [
        { s: '3', t: 'parties', o: 'U', d: { id: 'p1', business_id: SHOP, name: 'OLD — already in the copy' } },
        { s: '4', t: 'parties', o: 'U', d: { id: 'p1', business_id: SHOP, name: 'Verma Traders' } },
        { s: '5', t: 'parties', o: 'D', d: { id: 'p2', business_id: SHOP, name: 'Gone soon' } },
      ] },
      { changes: [
        { s: '6', t: 'sales_documents', o: 'I', d: { id: 's1', business_id: SHOP, party_id: 'p1', kind: 'invoice', date: '2026-10-12', total: 1180.5 }, at: '2026-10-12T08:31:00.000Z' },
        { s: '6', t: 'sales_documents', o: 'I', d: { id: 's1', business_id: SHOP, total: 0 } },
      ] },
    ]);
    expect(applied).toBe(3);
    expect(lastAt).toBe('2026-10-12T08:31:00.000Z');
    expect([...books.get('parties')!.values()].map((p) => p.name)).toEqual(['Verma Traders']);
    expect(books.get('sales_documents')!.get('s1')!.total).toBe(1180.5);
    expect(books.has('old_table_no_longer_there')).toBe(false);
    expect(summarise(books, { start: '2026-04-01', end: '2027-03-31' })).toMatchObject({ invoices: 1, parties: 1, salesTotalThisYear: '1180.50' });
  });

  it('gives restored books new ids and keeps every link between rows', () => {
    const USER = '33333333-3333-4333-8333-333333333333';
    const P1 = '44444444-4444-4444-8444-444444444444';
    const S1 = '55555555-5555-4555-8555-555555555555';
    const books: Books = new Map<string, Map<string, Row>>([
      ['businesses', new Map<string, Row>([[SHOP, { id: SHOP, name: 'Sharma' }]])],
      ['parties', new Map<string, Row>([[P1, { id: P1, business_id: SHOP, created_by: USER }]])],
      ['sales_documents', new Map<string, Row>([[S1, { id: S1, business_id: SHOP, party_id: P1, notes: { linked: [P1.toUpperCase()] } }]])],
      ['business_settings', new Map<string, Row>([[SHOP, { business_id: SHOP, data: { defaultParty: P1 } }]])],
    ]);
    const out = remapIds(books, TABLES, SHOP, OTHER);
    const p = [...out.get('parties')!.values()][0]!;
    const s = [...out.get('sales_documents')!.values()][0]!;
    expect(p.id).not.toBe(P1);
    expect(p).toMatchObject({ business_id: OTHER, created_by: USER });
    expect(s).toMatchObject({ business_id: OTHER, party_id: p.id, notes: { linked: [p.id] } });
    expect(out.get('business_settings')!.get(OTHER)).toEqual({ business_id: OTHER, data: { defaultParty: p.id } });
    expect(out.get('businesses')!.get(OTHER)!.id).toBe(OTHER);
    // the backup itself is unchanged
    expect(books.get('parties')!.get(P1)!.id).toBe(P1);
  });
});
