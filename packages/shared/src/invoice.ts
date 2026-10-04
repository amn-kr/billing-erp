/**
 * Invoice and bill maths — the prototype's calc() (sales) and puCalc() (purchases)
 * in Decimal, with the same rounding points, so totals match the old app.
 *
 * One deliberate difference: SGST = tax − CGST (the prototype showed r2(tax/2)
 * twice, which could add up to a paisa more than the tax).
 */
import { D, money, round2, type Money, type MoneyInput } from './money.js';

/** gst = tax invoice; bos = bill of supply (composition dealer); none = GST off */
export type TaxMode = 'gst' | 'bos' | 'none';
export const taxModeOf = (gstEnabled: boolean, reg: string | undefined): TaxMode => (!gstEnabled ? 'none' : reg === 'composition' ? 'bos' : 'gst');

export interface LineIn {
  qty: MoneyInput;
  /** sale: price from the price list; purchase: rate */
  price: MoneyInput;
  /** discount % */
  disc?: MoneyInput;
  /** GST rate % */
  gst?: MoneyInput;
  /** sales only: a row with an item or a typed name (blank rows don't count) */
  counted?: boolean;
}
export interface DocIn {
  mode: TaxMode;
  /** prices include GST */
  incl: boolean;
  /** place of supply is another state (IGST) */
  inter: boolean;
  lines: LineIn[];
  /** bill discount: % (wins when set) or amount */
  bdiscP?: MoneyInput | null;
  bdisc?: MoneyInput | null;
  /** sales only: TCS rate % when TCS is on */
  tcsRate?: MoneyInput | null;
  chTr?: MoneyInput | null;
  chLab?: MoneyInput | null;
  chBank?: MoneyInput | null;
  roundOff: boolean;
}
export interface RowOut { gross: Money; disc: Money; tv: Money; tx: Money; amt: Money }
export interface TotalsOut {
  rows: RowOut[];
  items: Money; bdisc: Money; chTr: Money; chLab: Money; chBank: Money;
  taxable: Money; tax: Money; cgst: Money; sgst: Money; igst: Money; inter: boolean;
  tcs: Money; round: Money; total: Money;
  /** taxable value and tax per GST rate (for the tax summary and GSTR-1) */
  byRate: Record<string, { tv: Money; tx: Money }>;
  count: number;
}

const m0 = () => money(0);
const nz = (v: MoneyInput | null | undefined) => money(v ?? 0);
const pct = (v: Money, p: Money) => v.times(p).div(100);
const split = (tax: Money, inter: boolean) => {
  if (inter) return { cgst: m0(), sgst: m0(), igst: tax };
  const cgst = round2(tax.div(2));
  return { cgst, sgst: tax.minus(cgst), igst: m0() };
};
/** the prototype's Math.round for whole rupees (half up) */
const roundRupee = (v: Money) => v.toDecimalPlaces(0, D.ROUND_HALF_UP);

/** Sales invoice / quotation / challan totals (prototype calc()). */
export function saleTotals(d: DocIn): TotalsOut {
  const gst = d.mode === 'gst';
  let taxable = m0();
  let taxSum = m0();
  let count = 0;
  const byRate: Record<string, { tv: Money; tx: Money }> = {};
  const rows = d.lines.map((l) => {
    const gross = nz(l.qty).times(nz(l.price));
    const disc = pct(gross, nz(l.disc));
    const net = gross.minus(disc);
    const r = gst ? nz(l.gst).div(100) : m0();
    let tv: Money;
    let tx: Money;
    if (!gst) { tv = net; tx = m0(); }
    else if (d.incl) { tv = net.div(r.plus(1)); tx = net.minus(tv); }
    else { tv = net; tx = net.times(r); }
    if (l.counted !== false) {
      taxable = taxable.plus(tv);
      taxSum = taxSum.plus(tx);
      count++;
      if (gst) {
        const k = nz(l.gst).toString();
        const b = (byRate[k] ??= { tv: m0(), tx: m0() });
        b.tv = b.tv.plus(tv);
        b.tx = b.tx.plus(tx);
      }
    }
    return { gross, disc, tv: round2(tv), tx: round2(tx), amt: round2(tv.plus(tx)) };
  });
  const items = round2(taxable.plus(taxSum));
  const want = d.bdiscP ? round2(pct(items, nz(d.bdiscP))) : nz(d.bdisc);
  const bd = D.min(D.max(want, 0), items);
  if (bd.gt(0) && items.gt(0)) {
    const f = items.minus(bd).div(items);
    taxable = taxable.times(f);
    taxSum = taxSum.times(f);
    for (const b of Object.values(byRate)) { b.tv = b.tv.times(f); b.tx = b.tx.times(f); }
  }
  let total = taxable.plus(taxSum);
  let tcs = m0();
  if (gst && d.tcsRate) { tcs = round2(pct(total, nz(d.tcsRate))); total = total.plus(tcs); }
  const chTr = nz(d.chTr);
  const chLab = nz(d.chLab);
  const chBank = nz(d.chBank);
  total = total.plus(chTr).plus(chLab).plus(chBank);
  const exact = round2(total);
  const rounded = d.roundOff ? roundRupee(exact) : exact;
  const tax = round2(taxSum);
  return {
    rows, items, bdisc: round2(bd), chTr, chLab, chBank, taxable: round2(taxable), tax, ...split(tax, d.inter && gst), inter: d.inter && gst,
    tcs, round: round2(rounded.minus(exact)), total: round2(rounded),
    byRate: Object.fromEntries(Object.entries(byRate).map(([k, b]) => [k, { tv: round2(b.tv), tx: round2(b.tx) }])), count,
  };
}

/** Purchase bill / order / debit note totals (prototype puCalc()). */
export function purchaseTotals(d: DocIn): TotalsOut {
  const gst = d.mode === 'gst';
  let taxable = m0();
  let tax = m0();
  const byRate: Record<string, { tv: Money; tx: Money }> = {};
  const rows = d.lines.map((l) => {
    const g = gst ? nz(l.gst) : m0();
    const gross = nz(l.qty).times(nz(l.price));
    const disc = pct(gross, nz(l.disc));
    const net = gross.minus(disc);
    let tv: Money;
    let tx: Money;
    if (d.incl && !g.isZero()) { tv = net.div(g.div(100).plus(1)); tx = net.minus(tv); }
    else { tv = net; tx = pct(net, g); }
    taxable = taxable.plus(tv);
    tax = tax.plus(tx);
    if (gst) {
      const b = (byRate[g.toString()] ??= { tv: m0(), tx: m0() });
      b.tv = b.tv.plus(tv);
      b.tx = b.tx.plus(tx);
    }
    return { gross, disc: round2(disc), tv: round2(tv), tx: round2(tx), amt: round2(tv.plus(tx)) };
  });
  taxable = round2(taxable);
  tax = round2(tax);
  const items = round2(taxable.plus(tax));
  const want = d.bdiscP ? round2(pct(items, nz(d.bdiscP))) : nz(d.bdisc);
  const bd = D.min(D.max(want, 0), items);
  if (bd.gt(0) && items.gt(0)) {
    const f = items.minus(bd).div(items);
    taxable = round2(taxable.times(f));
    tax = round2(tax.times(f));
    for (const b of Object.values(byRate)) { b.tv = b.tv.times(f); b.tx = b.tx.times(f); }
  }
  const chTr = nz(d.chTr);
  const chLab = nz(d.chLab);
  const raw = taxable.plus(tax).plus(chTr).plus(chLab);
  const total = d.roundOff === false ? round2(raw) : roundRupee(raw);
  return {
    rows, items, bdisc: round2(bd), chTr, chLab, chBank: m0(), taxable, tax, ...split(tax, d.inter && gst), inter: d.inter && gst,
    tcs: m0(), round: round2(total.minus(raw)), total,
    byRate: Object.fromEntries(Object.entries(byRate).map(([k, b]) => [k, { tv: round2(b.tv), tx: round2(b.tx) }])), count: d.lines.length,
  };
}

const A = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const T = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (x: number) => (x < 20 ? A[x]! : T[Math.floor(x / 10)]! + (x % 10 ? ' ' + A[x % 10]! : ''));
const three = (x: number) => (x >= 100 ? A[Math.floor(x / 100)]! + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
function spell(x: number): string {
  if (!x) return 'Zero';
  let s = '';
  const cr = Math.floor(x / 1e7); x %= 1e7;
  const lk = Math.floor(x / 1e5); x %= 1e5;
  const th = Math.floor(x / 1e3); x %= 1e3;
  if (cr) s += (cr > 99 ? spell(cr) : two(cr)) + ' Crore ';
  if (lk) s += two(lk) + ' Lakh ';
  if (th) s += two(th) + ' Thousand ';
  if (x) s += three(x);
  return s.trim();
}
/** Amount in words, Indian style (prototype words()): "Rupees One Lakh Twenty Thousand and Fifty Paise Only". */
export function amountInWords(v: MoneyInput): string {
  const n = round2(v);
  const r = n.floor();
  const p = n.minus(r).times(100).toNumber();
  return 'Rupees ' + spell(r.toNumber()) + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
}
