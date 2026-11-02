/**
 * MRP (Features › mrp_pack, owner's request, 2 Nov 2026). A line's MRP is the lowest MRP of the batches it uses, else
 * the item's; no MRP, no check. MRP includes tax, so it is compared with what the customer pays per unit: the line's
 * amount (with GST, after its discount) ÷ its quantity, the same with prices with or without GST.
 */
import { money, type Money, type MoneyInput } from './money.js';

export function effectiveMrp(itemMrp: MoneyInput | null | undefined, batchMrps: readonly (MoneyInput | null | undefined)[] = []): Money | null {
  const positive = (v: MoneyInput | null | undefined) => v !== null && v !== undefined && v !== '' && money(v).gt(0);
  const list = batchMrps.filter(positive).map((v) => money(v!));
  if (list.length) return list.reduce((a, v) => (v.lt(a) ? v : a));
  return positive(itemMrp) ? money(itemMrp!) : null;
}

/** What the customer pays per unit, to the paisa. */
export const ratePerUnit = (amount: MoneyInput, qty: MoneyInput): Money => (money(qty).gt(0) ? money(amount).div(money(qty)).toDecimalPlaces(2) : money(0));

export const isAboveMrp = (amount: MoneyInput, qty: MoneyInput, mrp: Money | null): boolean => !!mrp && ratePerUnit(amount, qty).gt(mrp);
