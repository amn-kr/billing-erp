/**
 * Purchase rate of stock left (owner-approved addition, not in the prototype): which purchase rates
 * the stock on hand was bought at, oldest first, as the API works it out (first in, first out).
 * Rates are tinted light (cheapest) to strong (costliest); the bar under each quantity is its share
 * of the largest one; a sold-out rate is grey.
 */
import type { CSSProperties } from 'react';
import { formatInr2, formatQty, money, type RateTable as Table } from '@billing/shared';
import { dmy } from '../../lib/format';
import { useStyles } from '../../lib/useStyles';
import css from './rate-table.css?inline';

export function RateTable({ t, unit }: { t: Table; unit: string }) {
  useStyles([css], 'item-rate-table');
  if (!t.layers.length)
    return (
      <div className="itrt" id="itRates">
        <small>Purchase rate of stock left</small>
        <div className="itrte">{money(t.shortQty).gt(0)
          ? `Stock is short by ${formatQty(t.shortQty)} ${unit}: more was sold than was bought.${t.lastRate ? ` Last bought at ${formatInr2(t.lastRate)}.` : ''}`
          : t.lastRate ? `No stock left. Last bought at ${formatInr2(t.lastRate)}.` : 'No stock yet. Rates show here once you buy or add opening stock.'}</div>
      </div>
    );
  const live = t.layers.filter((l) => money(l.qty).gt(0));
  const lo = live.reduce((a, l) => (money(l.rate).lt(a) ? money(l.rate) : a), money(live[0]!.rate));
  const hi = live.reduce((a, l) => (money(l.rate).gt(a) ? money(l.rate) : a), money(live[0]!.rate));
  const most = live.reduce((a, l) => (money(l.qty).gt(a) ? money(l.qty) : a), money(0));
  /** tint strength: 10% for the lowest rate up to 42% for the highest */
  const k = (r: string) => (hi.eq(lo) ? 18 : money(r).minus(lo).div(hi.minus(lo)).times(32).plus(10).round().toNumber());
  const share = (q: string) => money(q).div(most).times(100).toDecimalPlaces(1).toNumber();
  const tip = (l: Table['layers'][number]) => money(l.qty).isZero()
    ? `${formatInr2(l.rate)} — bought from ${dmy(l.since)}, all sold`
    : `${formatInr2(l.rate)} — bought from ${dmy(l.since)}\n${formatQty(l.qty)} ${unit} left, worth ${formatInr2(money(l.qty).times(l.rate))}\n${money(l.qty).div(t.totalQty).times(100).round().toFixed(0)}% of the stock`;
  return (
    <div className="itrt" id="itRates">
      <small>Purchase rate of stock left</small>
      <div className="itrtw">
        <table className="itrtt">
          <tbody>
            <tr>
              <th scope="row">Rate</th>
              {t.layers.map((l, i) => {
                const z = money(l.qty).isZero();
                return <td key={i} className={z ? 'r z' : 'r'} title={tip(l)} style={z ? undefined : ({ '--k': k(l.rate) + '%' } as CSSProperties)}>{formatInr2(l.rate)}</td>;
              })}
              <td className="s" title={`Weighted average of the ${formatQty(t.totalQty)} ${unit} left, worth ${formatInr2(t.value)}`}><small>Avg rate</small><b>{formatInr2(t.avgRate)}</b></td>
            </tr>
            <tr>
              <th scope="row">Rest qty</th>
              {t.layers.map((l, i) => {
                const z = money(l.qty).isZero();
                return (
                  <td key={i} className={z ? 'q z' : 'q'} title={tip(l)}>
                    {formatQty(l.qty)}
                    {!z && <span className="bar"><i style={{ width: share(l.qty) + '%' }}></i></span>}
                  </td>
                );
              })}
              <td className="s"><small>Total qty</small><b>{formatQty(t.totalQty)} {unit}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="itrtk">
        <span><i></i>Lower to higher rate</span>
        <span>Bar: quantity left</span>
        {t.layers.some((l) => money(l.qty).isZero()) && <span><i className="z"></i>Sold out</span>}
        <span>Oldest first, sold first{t.hidden ? ` · ${t.hidden} older sold-out ${t.hidden === 1 ? 'rate' : 'rates'} hidden` : ''}</span>
      </div>
    </div>
  );
}
