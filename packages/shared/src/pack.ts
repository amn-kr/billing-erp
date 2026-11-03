/**
 * Pack and loose (Settings › Items › MRP and Pack, owner's request, 2 Nov 2026). An item can be sold by the pack and loose: 1 STRIP
 * = 10 TAB. Its stock is always counted in the loose unit, so every tablet is exact; its prices and MRP are per pack,
 * as printed on the pack, and the loose price is the pack's ÷ the pack size, to the paisa. A document's line keeps its
 * own quantity, unit and rate, plus the pack size when it is in packs (none = the item's own unit).
 */
import { formatQty, money, type Money, type MoneyInput } from './money.js';

export interface PackInfo { packUnit: string; packSize: MoneyInput }

/** How much stock a line moves: its quantity × its pack size. */
export const stockQtyOf = (qty: MoneyInput, packSize?: MoneyInput | null): Money => money(qty).times(packSize ? money(packSize) : 1).toDecimalPlaces(3);

/** The price of one loose unit, to the paisa (a sale, MRP). */
export const loosePrice = (packPrice: MoneyInput, packSize?: MoneyInput | null): Money => money(packPrice).div(packSize ? money(packSize) : 1).toDecimalPlaces(2);

/** The exact cost of one loose unit: a strip of 15 at ₹100 is 6.666667 a tablet, so 15 tablets are still worth ₹100.00. */
export const looseCost = (packCost: MoneyInput, packSize?: MoneyInput | null): Money => money(packCost).div(packSize ? money(packSize) : 1).toDecimalPlaces(6);

/** A loose quantity in both units: "5 STRIP 3 TAB", "2 STRIP", "3 TAB". Without a pack: "53 TAB". */
export function packQtyText(qty: MoneyInput, unit: string, pack?: PackInfo | null): string {
  const q = money(qty);
  if (!pack) return `${formatQty(q)} ${unit}`.trim();
  const size = money(pack.packSize);
  const whole = q.abs().div(size).floor();
  const rest = q.abs().minus(whole.times(size)).toDecimalPlaces(3);
  const sign = q.isNegative() ? '−' : '';
  const parts = [...(whole.gt(0) ? [`${formatQty(whole)} ${pack.packUnit}`] : []), ...(rest.gt(0) || whole.isZero() ? [`${formatQty(rest)} ${unit}`] : [])];
  return sign + parts.join(' ');
}
