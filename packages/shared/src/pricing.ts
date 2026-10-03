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
