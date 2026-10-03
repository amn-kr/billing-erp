/** Price-list maths, same as the prototype's plPrice() and rnd(), in Decimal. */
import { D, money, round2, type Money, type MoneyInput } from './money.js';

/** Round to the nearest `step` rupees (e.g. 1, 5, 10); step 0 = to the paisa. Half up. */
export function roundTo(v: MoneyInput, step: MoneyInput): Money {
  const s = money(step);
  if (s.isZero()) return round2(v);
  return money(v).div(s).toDecimalPlaces(0, D.ROUND_HALF_UP).times(s).toDecimalPlaces(2);
}

export type PriceRule = 'base' | 'disc' | 'mark';

/**
 * A price list's price for an item:
 * base = the item's sale price; disc = sale price − value %; mark = purchase price + value %.
 * A fixed price for the item in that list wins over the rule.
 */
export function listPrice(rule: PriceRule, value: MoneyInput, step: MoneyInput, item: { sale: MoneyInput; purchase: MoneyInput }, fixed?: MoneyInput | null): Money {
  if (fixed !== undefined && fixed !== null) return round2(fixed);
  if (rule === 'base') return round2(item.sale);
  if (rule === 'disc') return roundTo(money(item.sale).times(money(100).minus(value)).div(100), step);
  return roundTo(money(item.purchase).times(money(100).plus(value)).div(100), step);
}

/* ───────── brand / series pricing rules (Price manager › Price Setup › Brand rules) ───────── */

export interface RuleField { m: 'none' | 'lp' | 'margin' | 'lpup'; v: string; rd: string }
/** One saved rule: a RuleField per sale price ('sale' or 'pl:<list id>'), plus a minimum margin and a fallback for items without LP. */
export type PriceRuleSet = { floor?: { on: boolean; v: string | number }; noLp?: { on: boolean; v: string | number } } & { [field: string]: RuleField | { on: boolean; v: string | number } | undefined };

/** Round up to the next ₹step (the prototype's Math.ceil(p/rd)·rd); step 0 = to the paisa, half up. */
export function ceilTo(v: MoneyInput, step: MoneyInput): Money {
  const s = money(step);
  if (s.isZero()) return round2(v);
  return money(v).div(s).ceil().times(s).toDecimalPlaces(2);
}

/**
 * The prototype's prPrice(): the price a rule gives an item for one sale price.
 * lp = List Price − v %, lpup = List Price + v %, margin = purchase + v %.
 * Without a List Price an lp rule uses "purchase + noLp %" when that is on (fb);
 * the minimum margin (floor) lifts the price to purchase + floor % (floor).
 * null when the rule can't price this item.
 */
export function rulePrice(item: { lp: MoneyInput; purch: MoneyInput }, field: string, rule: PriceRuleSet | null | undefined): { p: Money; floor: boolean; fb: boolean } | null {
  if (!rule) return null;
  const x = rule[field] as RuleField | undefined;
  if (!x || x.m === 'none' || x.v === '' || x.v === undefined) return null;
  const v = money(x.v || 0);
  const lp = money(item.lp || 0);
  const purch = money(item.purch || 0);
  const pct = (base: Money, plus: Money) => base.times(money(100).plus(plus)).div(100);
  let p: Money;
  let fb = false;
  if ((x.m === 'lp' || x.m === 'lpup') && !lp.gt(0)) {
    if (rule.noLp?.on && purch.gt(0)) { p = pct(purch, money(rule.noLp.v || 0)); fb = true; } else return null;
  } else if (x.m === 'lp') p = pct(lp, v.neg());
  else if (x.m === 'lpup') p = pct(lp, v);
  else if (x.m === 'margin') { if (!purch.gt(0)) return null; p = pct(purch, v); } else return null;
  let floor = false;
  if (rule.floor?.on && purch.gt(0)) {
    const mn = pct(purch, money(rule.floor.v || 0));
    if (p.lt(mn)) { p = mn; floor = true; }
  }
  const rd = money(x.rd || 0);
  p = rd.isZero() ? (floor ? p.times(100).ceil().div(100) : round2(p)) : ceilTo(p, rd);
  return { p: p.lt(0) ? money(0) : p, floor, fb };
}
