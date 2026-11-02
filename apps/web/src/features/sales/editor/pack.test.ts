/** Pack and loose on a sale line (Features › mrp_pack): which unit it starts on, the price of each unit, and what it moves. */
import { describe, expect, it } from 'vitest';
import { cmApply, lineFor, linePack, lineStock, newSI, priceFor, setLineUnit, stockText, type Ctx, type EItem } from './state';

const it0: EItem = { id: 'i', name: 'Paracetamol', code: '', hsn: '', unit: 'TAB', cat: 'Med', gst: 0, stock: 53, svc: false, brand: '', series: '', grp: '', purch: 70, sale: 100, mrp: 120, pl: { w: 90 }, pack: { unit: 'STRIP', size: 15 } };
const plain: EItem = { ...it0, id: 'p', pack: undefined, unit: 'PCS' };
const ctx = (packOn: boolean, extra: Partial<Ctx> = {}): Ctx => ({ mode: 'none' as Ctx['mode'], state: '09', tcsRate: null, defaultList: null, listForGroup: {}, listName: {}, rules: {}, packOn, ...extra });
const si = (c: Ctx) => newSI(c, { no: 'INV-1', date: '2026-11-02' });

describe('a line of an item sold by the pack', () => {
  it('starts on the pack at the pack’s price; other items are as today', () => {
    const c = ctx(true);
    expect(lineFor(c, si(c), it0)).toMatchObject({ unit: 'STRIP', price: 100 });
    expect(lineFor(c, si(c), plain)).toMatchObject({ unit: 'PCS', price: 100 });
  });

  it('with the feature off it is sold loose, at the loose price', () => {
    const c = ctx(false);
    expect(lineFor(c, si(c), it0)).toMatchObject({ unit: 'TAB', price: 6.67 });
  });

  it('changing unit gives that unit’s price and picks batches afresh; a price list is per pack too', () => {
    const c = ctx(true), s = si(c);
    const l = lineFor(c, s, it0);
    l.batches = [{ batchId: 'a', qty: '15.000' }];
    setLineUnit(c, s, l, 'TAB');
    expect(l).toMatchObject({ unit: 'TAB', price: 6.67 });
    expect(l.batches).toBeUndefined();
    setLineUnit(c, s, l, 'STRIP');
    expect(l).toMatchObject({ unit: 'STRIP', price: 100 });
    const listed = ctx(true, { defaultList: 'w' });
    expect(priceFor(listed, it0, null, 'STRIP')).toBe(90);
    expect(priceFor(listed, it0, null, 'TAB')).toBe(6);
  });

  it('moves stock in the loose unit', () => {
    const c = ctx(true), s = si(c);
    const l = lineFor(c, s, it0);
    l.qty = 2;
    expect(linePack(l)).toBe(15);
    expect(lineStock(l)).toBe(30);
    setLineUnit(c, s, l, 'TAB');
    expect(linePack(l)).toBeNull();
    expect(lineStock(l)).toBe(2);
    expect(stockText(it0, 53)).toBe('3 STRIP 8 TAB');
    expect(stockText(plain, 53)).toBe('53 PCS');
  });

  it('a fixed referral commission is per pack, so a loose unit carries its share; a percent is the same on both', () => {
    const c = ctx(true, { rules: { Med: { t: 'f', v: 15 } } }), s = si(c);
    s.ref = 'r';
    const l = lineFor(c, s, it0);
    expect(l).toMatchObject({ price: 115, bp: 100 });
    setLineUnit(c, s, l, 'TAB');
    expect(l).toMatchObject({ price: 7.67, bp: 6.67 });
    const p = ctx(true, { rules: { Med: { t: 'p', v: 10 } } }), s2 = si(p);
    s2.ref = 'r';
    const l2 = lineFor(p, s2, it0);
    cmApply(p, s2, l2);
    expect(l2.price).toBe(110);
  });
});
