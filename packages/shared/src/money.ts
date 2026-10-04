/**
 * Money maths. Never use JavaScript numbers for totals: 0.1 + 0.2 !== 0.3.
 * Amounts are Decimal in code and numeric(14,2) in the database.
 */
import Decimal from 'decimal.js';

/** A Decimal class configured for money (half-up rounding, like the GST portal). */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Money = InstanceType<typeof D>;
export type MoneyInput = Money | string | number;

export const money = (v: MoneyInput | null | undefined): Money => {
  if (v === null || v === undefined || v === '') return new D(0);
  if (typeof v === 'string') return new D(v.replace(/[₹,\s]/g, '') || 0);
  return new D(v);
};

/** Round to paise (2 decimals), half-up. */
export const round2 = (v: MoneyInput): Money => money(v).toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Round to whole rupees, half-up (invoice round-off). */
export const round0 = (v: MoneyInput): Money => money(v).toDecimalPlaces(0, D.ROUND_HALF_UP);

export const sum = (values: MoneyInput[]): Money => values.reduce<Money>((a, v) => a.plus(money(v)), new D(0));

/** String with exactly 2 decimals, as stored in numeric(14,2). */
export const toDb = (v: MoneyInput): string => round2(v).toFixed(2);

/** Largest value numeric(14,2) can hold. */
export const MONEY_MAX = new D('999999999999.99');

const grouped = (s: string): string => {
  // Indian digit grouping: 12,34,56,789
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [int = '0', frac] = body.split('.');
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + (rest ? rest + ',' + last3 : last3) + (frac !== undefined ? '.' + frac : '');
};

/** Quantity as the prototype's qfmt shows it: up to 2 decimals, no trailing zeros. 7.000 -> "7", 1250.5 -> "1,250.5". */
export const formatQty = (v: MoneyInput): string => {
  const r = round2(v);
  return grouped(r.isInteger() ? r.toFixed(0) : r.toFixed(2).replace(/0$/, ''));
};

/** 1234567.5 -> "12,34,568" (prototype `inr` without the symbol). */
export const formatInr0 = (v: MoneyInput): string => grouped(round0(v).toFixed(0));

/** 1234567.5 -> "12,34,567.50" (prototype `inr2f`). */
export const formatInr2 = (v: MoneyInput): string => grouped(round2(v).toFixed(2));

/** 1234567.5 -> "₹12,34,568" (prototype `inr`). */
export const formatRupees = (v: MoneyInput): string => '₹' + formatInr0(v);
