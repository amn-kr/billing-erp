/**
 * MRP (Settings › Items › MRP and Pack, owner's request, 2 Nov 2026). A line's MRP is the lowest MRP of the stock it uses: a batch's
 * own, else the item's (also for stock without a batch); no MRP, no check. MRP includes tax, so it is compared with what the customer pays per unit: the line's
 * amount (with GST, after its discount) ÷ its quantity, the same with prices with or without GST.
 */
import { money, type Money, type MoneyInput } from './money.js';

export function effectiveMrp(itemMrp: MoneyInput | null | undefined, batchMrps: readonly (MoneyInput | null | undefined)[] = []): Money | null {
  const positive = (v: MoneyInput | null | undefined) => v !== null && v !== undefined && v !== '' && money(v).gt(0);
  // a part without its own MRP counts at the item's, so it can't escape the check
  const list = (batchMrps.length ? batchMrps.map((v) => (positive(v) ? v : itemMrp)) : [itemMrp]).filter(positive).map((v) => money(v!));
  return list.length ? list.reduce((a, v) => (v.lt(a) ? v : a)) : null;
}

/** What the customer pays per unit, to the paisa. */
export const ratePerUnit = (amount: MoneyInput, qty: MoneyInput): Money => (money(qty).gt(0) ? money(amount).div(money(qty)).toDecimalPlaces(2) : money(0));

export const isAboveMrp = (amount: MoneyInput, qty: MoneyInput, mrp: Money | null): boolean => !!mrp && ratePerUnit(amount, qty).gt(mrp);
