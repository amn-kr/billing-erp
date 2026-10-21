import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PARTY_EXAMPLE_ROW, PARTY_IMPORT_KEYS, type PartyImportRow } from '@billing/shared';
import { PartiesService } from '../src/modules/parties/parties.service';
import { auth, member, owner, startApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); });

type S = { token: string };
/** made-up GSTINs with a correct check digit (09 = Uttar Pradesh, 27 = Maharashtra) */
const G09 = '09AAJPM7745Q1ZP';
const G27 = '27ABCDE1234F1Z0';
const row = (line: number, v: Partial<PartyImportRow>): PartyImportRow => ({ line, ...Object.fromEntries(PARTY_IMPORT_KEYS.map((k) => [k, ''])), ...v }) as PartyImportRow;
const run = (s: S, rows: PartyImportRow[]) => http().post('/api/parties/import').set(auth(s)).send({ rows });
interface Party { id: string; name: string; kind: string; group: string; phone: string; email: string; gstin: string; gstType: string; state: string; creditLimit: string | null; openingBalance: string; openingType: string; openingDate: string | null; balance: string; billing: { line: string; city: string } | null }
const parties = async (s: S) => (await http().get('/api/parties').set(auth(s)).expect(200)).body as Party[];
const byName = async (s: S, name: string) => (await parties(s)).find((p) => p.name === name)!;
const audit = async (s: S) => (await http().get('/api/audit?limit=200').set(auth(s)).expect(200)).body as { action: string; entity: string; entityId: string; after: Record<string, unknown> }[];

describe('Parties › Import Parties', () => {
  it('gives the shop’s party names and phones to check against, and whether GST is on', async () => {
    const o = await owner(app);
    await http().post('/api/parties').set(auth(o)).send({ name: 'Mehta Electricals', phone: '9876543210' }).expect(201);
    const c = (await http().get('/api/parties/import/context').set(auth(o)).expect(200)).body;
    expect(c).toEqual({ parties: [{ name: 'Mehta Electricals', phone: '9876543210' }], gst: true });
  });

  it('a valid batch: every party saved exactly as Add party saves it, with the right balances', async () => {
    const o = await owner(app);
    const r = await run(o, [
      row(2, { name: 'Sharma Traders', type: 'Customer', phone: '+91 91234 56780', email: 'sharma@example.com', gstin: G09, address: 'Shop 4, Aminabad', city: 'Lucknow', opening: '12,500.50', balType: 'To receive', limit: '50000' }),
      row(3, { name: 'Gupta Wires', type: 'supplier', state: 'Maharashtra', gstin: G27, opening: '8000', balType: 'To pay' }),
      row(4, { name: 'Walk-in Verma', opening: '300', balType: 'to collect' }),
      row(5, { name: 'No balance supplier', type: 'Supplier' }),
    ]).expect(200);
    expect(r.body.saved.map((x: { line: number; name: string }) => [x.line, x.name])).toEqual([[2, 'Sharma Traders'], [3, 'Gupta Wires'], [4, 'Walk-in Verma'], [5, 'No balance supplier']]);
    expect(r.body.rejected).toEqual([]);
    expect(r.body.skipped).toEqual([]);

    const s = await byName(o, 'Sharma Traders');
    expect(s).toMatchObject({
      kind: 'customer', group: 'General', phone: '9123456780', email: 'sharma@example.com', gstin: G09, gstType: 'Registered business – regular', state: '09',
      creditLimit: '50000.00', openingBalance: '12500.50', openingType: 'receive', balance: '12500.50', billing: { line: 'Shop 4, Aminabad', city: 'Lucknow' },
    });
    expect(s.openingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await byName(o, 'Gupta Wires')).toMatchObject({ kind: 'supplier', state: '27', openingBalance: '8000.00', openingType: 'pay', balance: '-8000.00', creditLimit: null });
    expect(await byName(o, 'Walk-in Verma')).toMatchObject({ kind: 'customer', gstType: 'Unregistered / consumer', balance: '300.00' });
    // no opening balance: no date, and the type Add party picks for a supplier
    expect(await byName(o, 'No balance supplier')).toMatchObject({ openingBalance: '0.00', openingType: 'pay', openingDate: null, balance: '0.00' });

    // the opening balance shows in the party's transactions, as for a party made with Add party
    const tx = (await http().get(`/api/reports/party-tx/${s.id}`).set(auth(o)).expect(200)).body as { type: string; total: string }[];
    expect(tx).toEqual([expect.objectContaining({ type: 'Opening balance', total: '12500.50' })]);
  });

  it('the same party through Add party and through the import is saved the same way', async () => {
    const o = await owner(app);
    await http().post('/api/parties').set(auth(o)).send({ name: 'By hand', kind: 'customer', phone: '9000000001', gstin: G09, gstType: 'Registered business – regular', state: '09', billing: { line: 'Road 1', city: 'Agra', pin: '', state: '' }, openingBalance: '99.99', openingType: 'receive', creditLimit: '1000' }).expect(201);
    await run(o, [row(2, { name: 'By import', phone: '9000000002', gstin: G09, address: 'Road 1', city: 'Agra', opening: '99.99', balType: 'To receive', limit: '1000' })]).expect(200);
    const strip = ({ id: _i, name: _n, phone: _p, createdAt: _c, ...rest }: Party & { createdAt?: string }) => rest;
    expect(strip(await byName(o, 'By import'))).toEqual(strip(await byName(o, 'By hand')));
  });

  it('a mixed batch: only the OK rows are saved; rejected and skipped rows are listed with the reason', async () => {
    const o = await owner(app);
    const r = await run(o, [
      row(2, { name: 'Good one', phone: '9111111111' }),
      row(3, { name: 'Bad GSTIN', gstin: '09AAJPM7745Q1Z2' }),
      row(4, { name: 'Bad amount', opening: '10.555', balType: 'To pay' }),
      row(5, { name: 'Both kinds', type: 'Both' }),
      row(6, { name: 'good ONE' }),
      row(7, { name: 'Same phone', phone: '91111 11111' }),
      row(8, {}),
    ]).expect(200);
    expect(r.body.saved.map((x: { name: string }) => x.name)).toEqual(['Good one']);
    expect(r.body.rejected).toEqual([
      { line: 3, reasons: ['GSTIN: This GSTIN is not valid: its last character does not match. Check it for a typing mistake.'] },
      { line: 4, reasons: ['Opening balance: At most 2 decimals (paise).'] },
      { line: 5, reasons: ['Party type: This app has no “Both” party type yet. Choose Customer or Supplier.'] },
    ]);
    expect(r.body.skipped).toEqual([
      { line: 6, reasons: ['Same party name as row 2.'] },
      { line: 7, reasons: ['Same phone as row 2.'] },
    ]);
    expect((await parties(o)).map((p) => p.name)).toEqual(['Good one']);
  });

  it('a name or phone the shop already has is skipped, and the existing party is not changed', async () => {
    const o = await owner(app);
    const old = (await http().post('/api/parties').set(auth(o)).send({ name: 'Mehta Electricals', phone: '9876543210', email: 'old@example.com' }).expect(201)).body as Party;
    const r = await run(o, [
      row(2, { name: 'MEHTA electricals', email: 'new@example.com', opening: '500', balType: 'To receive' }),
      row(3, { name: 'Another Mehta', phone: '9876543210' }),
    ]).expect(200);
    expect(r.body.saved).toEqual([]);
    expect(r.body.skipped).toEqual([
      { line: 2, reasons: ['A party named “Mehta Electricals” already exists.'] },
      { line: 3, reasons: ['Phone 9876543210 is already used by “Mehta Electricals”.'] },
    ]);
    const now = await byName(o, 'Mehta Electricals');
    expect(now).toMatchObject({ id: old.id, email: 'old@example.com', openingBalance: '0.00', balance: '0.00' });
    expect((await parties(o)).length).toBe(1);
  });

  it('the sample file’s example row left in the file is skipped as an example row, never saved', async () => {
    const o = await owner(app);
    const r = await run(o, [row(2, PARTY_EXAMPLE_ROW), row(3, { name: 'Real party' })]).expect(200);
    expect(r.body.saved.map((x: { name: string }) => x.name)).toEqual(['Real party']);
    expect(r.body.examples).toEqual([{ line: 2, reasons: ['The example row from the sample file. Replace it with your own parties.'] }]);
    expect(r.body.rejected).toEqual([]);
    expect(r.body.skipped).toEqual([]);
    expect((await parties(o)).map((p) => p.name)).toEqual(['Real party']);
  });

  it('an archived party’s name can be used again (as with Add party)', async () => {
    const o = await owner(app);
    const old = (await http().post('/api/parties').set(auth(o)).send({ name: 'Old shop' }).expect(201)).body as Party;
    await http().post(`/api/parties/${old.id}/archive`).set(auth(o)).expect(200);
    expect((await run(o, [row(2, { name: 'Old shop' })]).expect(200)).body.saved.length).toBe(1);
  });

  it('an invalid GSTIN rejects its row on the server too, even if the browser let it through', async () => {
    const o = await owner(app);
    const r = await run(o, [row(2, { name: 'Wrong GSTIN', gstin: '27ABCDE1234F1Z1' }), row(3, { name: 'Wrong state', gstin: G27, state: 'Gujarat' })]).expect(200);
    expect(r.body.saved).toEqual([]);
    expect(r.body.rejected.map((x: { line: number }) => x.line)).toEqual([2, 3]);
    expect(await parties(o)).toEqual([]);
  });

  it('refuses more than 1000 rows (nothing saved), empty batches and people without permission', async () => {
    const o = await owner(app);
    const many = Array.from({ length: 1001 }, (_, i) => row(i + 2, { name: `Party ${i}` }));
    expect((await run(o, many).expect(400)).body.message).toBe('At most 1,000 parties can be imported at once. Split the rows into smaller files.');
    expect((await run(o, []).expect(400)).body.message).toBe('There are no rows to import.');
    const staff = await member(app, o, 'billing_staff');
    await run(staff, [row(2, { name: 'Sneaky' })]).expect(403);
    expect(await parties(o)).toEqual([]);
  });

  it('saves 1000 rows in one go', async () => {
    const o = await owner(app);
    const many = Array.from({ length: 1000 }, (_, i) => row(i + 2, { name: `Party ${i}`, opening: '1.01', balType: 'To receive' }));
    const r = await run(o, many).expect(200);
    expect(r.body.saved.length).toBe(1000);
    const all = await parties(o);
    expect(all.length).toBe(1000);
    expect(all.every((p) => p.balance === '1.01')).toBe(true);
  }, 120_000);

  it('a failure part-way leaves nothing saved', async () => {
    const o = await owner(app);
    const svc = app.get(PartiesService);
    const real = svc.insert.bind(svc);
    let n = 0;
    const spy = vi.spyOn(svc, 'insert').mockImplementation(async (...a) => { if (++n === 3) throw new Error('disk full'); return real(...a); });
    try {
      await run(o, [row(2, { name: 'One' }), row(3, { name: 'Two' }), row(4, { name: 'Three' })]).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await parties(o)).toEqual([]);
    expect((await audit(o)).filter((a) => a.entity === 'party')).toEqual([]);
  });

  it('writes one audit entry per saved party, marked as an import with its row number', async () => {
    const o = await owner(app);
    const r = await run(o, [row(2, { name: 'Audit me', opening: '250', balType: 'To pay' }), row(3, { name: 'Rejected', gstin: 'X' })]).expect(200);
    const id = r.body.saved[0].id as string;
    const a = (await audit(o)).filter((x) => x.entity === 'party');
    expect(a.length).toBe(1);
    expect(a[0]).toMatchObject({ action: 'create', entityId: id, after: { name: 'Audit me', openingBalance: '250.00', openingType: 'pay', from: 'import', line: 2 } });
  });

  it('another shop cannot see these parties, and its parties do not count as duplicates', async () => {
    const a = await owner(app);
    const b = await owner(app);
    await run(a, [row(2, { name: 'Shared name', phone: '9222222222' })]).expect(200);
    const r = await run(b, [row(2, { name: 'Shared name', phone: '9222222222' })]).expect(200);
    expect(r.body.saved.length).toBe(1);
    expect(r.body.skipped).toEqual([]);
    const aId = (await byName(a, 'Shared name')).id;
    const bParties = await parties(b);
    expect(bParties.map((p) => p.id)).not.toContain(aId);
    await http().get(`/api/parties/${aId}`).set(auth(b)).expect(404);
    expect((await http().get('/api/parties/import/context').set(auth(b)).expect(200)).body.parties).toEqual([{ name: 'Shared name', phone: '9222222222' }]);
    expect((await audit(b)).filter((x) => x.entity === 'party').map((x) => x.entityId)).toEqual([bParties[0]!.id]);
  });
});
