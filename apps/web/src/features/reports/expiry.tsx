/**
 * Expiry monitoring (Features › batch_expiry; owner-approved mocks, 2 Nov 2026). Expiry Report: batches expired or expiring
 * within 90 days, with their supplier and value, from the same lot calculation as the stock value; each can go back to the
 * supplier on a debit note or, when expired, be written off with a stock adjustment. Batch Wise Sales And Profit: what each
 * batch sold in a period, after returns.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { batchMonth, can, expiryLabel, formatInr2, loosePrice, matchesExpiry, money, packQtyText, sumValues, type BatchRow, type ExpiryFilter, type MeResponse, type PackInfo } from '@billing/shared';
import { atButton, RowMenu, RowMenuButton, rowMenuHandlers, type RowAction, type RowMenuAt } from '../../components/RowMenu';
import { api } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { AdjustStockDialog, type AdjustPreset } from '../items/AdjustStockDialog';
import { ExpiryTag } from '../items/BatchCard';
import type { Item } from '../items/ItemsPage';
import { range } from './periods';
import { printable, RpShell, Sel, type RpDef } from './Shell';
import type { RpProps } from './ReportsPage';
import { ui } from '../../styles/uiSize';

export interface ExpiryRow extends BatchRow { itemId: string; item: string; code: string; unit: string; packUnit: string; packSize: string | null; supplierId: string | null; supplier: string; billId: string | null; billNo: string }
interface ExpiryData { writtenOff: string; rows: ExpiryRow[] }
interface SoldRow { itemId: string; item: string; unit: string; packUnit: string; packSize: string | null; batchId: string | null; no: string; expiry: string | null; qty: string; sale: string; cost: string; profit: string }

const CHIPS: [ExpiryFilter, string][] = [['all', 'All'], ['expired', 'Expired'], [30, '30 days'], [60, '60 days'], [90, '90 days']];
const packOf = (r: { packUnit: string; packSize: string | null }): PackInfo | null => (r.packUnit && r.packSize ? { packUnit: r.packUnit, packSize: r.packSize } : null);
/** "All" here: expired, or expiring within 90 days. */
const listed = (r: ExpiryRow, on: string) => matchesExpiry(r.expiry, on, 'expired') || matchesExpiry(r.expiry, on, 90);

/** The figures: the report and the alert on Home read the same ones. */
export const useExpiry = (enabled: boolean) => useQuery({ queryKey: ['items', 'expiry'], queryFn: () => api<ExpiryData>(`/reports/expiry?today=${today()}`), enabled });
/** Home's alert: what is expired or expiring within 90 days. */
export function expirySummary(rows: ExpiryRow[], on: string) {
  const L = rows.filter((r) => listed(r, on)), expired = L.filter((r) => matchesExpiry(r.expiry, on, 'expired')).length;
  return { value: sumValues(L.map((r) => r.value)), expired, soon: L.length - expired };
}

/** A debit note for this batch: whole packs in packs, the rest loose, at what it cost. */
function returnUrl(r: ExpiryRow) {
  const pack = packOf(r);
  const whole = pack && money(r.qty).mod(money(pack.packSize)).isZero();
  const q = new URLSearchParams({ kind: 'debit_note', item: r.itemId, batch: r.id!, n: String(Date.now()),
    qty: whole ? money(r.qty).div(money(pack.packSize)).toString() : money(r.qty).toString(), unit: whole ? pack.packUnit : r.unit, rate: pack && !whole ? loosePrice(r.rate, pack.packSize).toFixed(2) : r.rate });
  if (r.supplierId) q.set('party', r.supplierId);
  if (r.billId) q.set('bill', r.billId);
  return `/purchases/new?${q}`;
}

export function ExpiryReport(props: RpProps) {
  const on = today();
  const nav = useNavigate();
  const me = useOutletContext<MeResponse | undefined>();
  const q = useExpiry(true);
  const items = useQuery({ queryKey: ['items'], queryFn: () => api<Item[]>('/items') });
  const [f, setF] = useState<ExpiryFilter>('all');
  const [sup, setSup] = useState('');
  const [menu, setMenu] = useState<RowMenuAt<ExpiryRow> | null>(null);
  const [off, setOff] = useState<{ item: Item; preset: AdjustPreset } | null>(null);
  if (!q.data) return null;
  const sups = [...new Map(q.data.rows.filter((r) => r.supplierId).map((r) => [r.supplierId!, r.supplier])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const base = q.data.rows.filter((r) => listed(r, on) && (!sup || r.supplierId === sup));
  const A = f === 'all' ? base : base.filter((r) => matchesExpiry(r.expiry, on, f));
  const value = (L: ExpiryRow[]) => sumValues(L.map((r) => r.value));
  const m = menu?.row;
  const canReturn = can(me?.permissions, 'purchases.manage'), canOff = can(me?.permissions, 'masters.manage');
  const acts: RowAction[] = [...(canReturn ? [['ret', 'Return to supplier'] as RowAction] : []), ...(canOff && m && matchesExpiry(m.expiry, on, 'expired') ? [['off', 'Write off'] as RowAction] : []), ['open', 'Open item']];
  const pick = (a: string) => {
    const r = menu!.row;
    setMenu(null);
    if (a === 'open') return nav('/items', { state: { open: r.itemId } });
    if (a === 'ret') return nav(returnUrl(r));
    const it = items.data?.find((i) => i.id === r.itemId);
    if (it) setOff({ item: it, preset: { batchId: r.id!, qty: String(Number(r.qty)), rate: money(r.value).div(money(r.qty)).toDecimalPlaces(2).toString(), why: 'Expired' } });
  };
  const rm = rowMenuHandlers('#rpMain tr[data-rpk]', (tr) => A.find((r) => r.id === tr.dataset.rpk), setMenu);
  const def: RpDef = {
    title: 'Expiry Report', group: 'Item/ Stock report', period: false, sub: f === 'all' ? '' : CHIPS.find((c) => c[0] === f)![1],
    filters: <>
      <div className="seg2" id="rpExF" style={{ marginBottom: ui.sp(4) }}>{CHIPS.map(([k, label]) => <button type="button" key={String(k)} data-exf={String(k)} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{label}</button>)}</div>
      <Sel id="rpExSup" label="Supplier" value={sup} onChange={setSup} opts={[['', 'All suppliers'], ...sups]} />
    </>,
    kpis: [['Expired', inr2f(value(base.filter((r) => matchesExpiry(r.expiry, on, 'expired')))), 'pscl neg'], ['In 30 days', inr2f(value(base.filter((r) => matchesExpiry(r.expiry, on, 30))))], ['In 90 days', inr2f(value(base.filter((r) => matchesExpiry(r.expiry, on, 90))))], ['Written off this year', inr2f(q.data.writtenOff)]],
    cols: [{ h: 'Item', w: 30 }, { h: 'Batch', w: 14 }, { h: 'Expiry', w: 10 }, { h: '', w: 12 }, { h: 'Supplier', w: 24 }, { h: 'In stock', n: true }, { h: 'Value', n: true }, { h: '', act: true, cls: 'slact' }],
    rows: A.map((r) => ({ k: r.id!, c: [r.item, r.no, batchMonth(r.expiry), expiryLabel(r.expiry, on), r.supplier || '—', packQtyText(r.qty, r.unit, packOf(r)), inr2f(r.value), ''],
      h: { 3: <ExpiryTag expiry={r.expiry} on={on} />, 7: <RowMenuButton no={r.id!} label={`Actions for ${r.no}`} onOpen={(b) => setMenu({ row: r, ...atButton(b), tr: b.closest('tr') })} /> } })),
    foot: ['Total', '', '', '', '', '', inr2f(value(A)), ''], empty: 'No batches are expired or expiring soon.',
    note: 'Values use the same purchase rates as the stock value. Supplier is who the batch was last bought from. Click a row to open the item.',
    click: (k) => nav('/items', { state: { open: A.find((r) => r.id === k)!.itemId } }),
  };
  return (
    <div onContextMenu={rm.onContextMenu} onKeyDown={(e) => { rm.menuKey(e); }}>
      <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(printable(def))} />
      <RowMenu id="exCtx" label="Batch actions" rows="#rpMain tr[data-rpk]" menu={menu} head={m ? <><b>{m.no}</b> · {m.item}</> : null} actions={acts}
        onClose={() => { const tr = menu?.tr; setMenu(null); return tr; }} onPick={pick} />
      <AdjustStockDialog item={off?.item ?? null} preset={off?.preset} onClose={() => setOff(null)} />
    </div>
  );
}

export function BatchSalesReport(props: RpProps) {
  const [from, to] = range(props.p);
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['items', 'batch-sales', from, to], queryFn: () => api<SoldRow[]>(`/reports/batch-sales?from=${from}&to=${to}`) });
  const [item, setItem] = useState('');
  if (!q.data) return null;
  const its = [...new Map(q.data.map((r) => [r.itemId, r.item])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const A = q.data.filter((r) => !item || r.itemId === item);
  const sum = (k: 'sale' | 'cost' | 'profit') => A.reduce((a, r) => a.plus(r[k]), money(0));
  const margin = (profit: { toString(): string }, sale: { toString(): string }) => (money(sale.toString()).gt(0) ? `${money(profit.toString()).div(money(sale.toString())).times(100).toDecimalPlaces(1).toFixed(1)}%` : '—');
  const def: RpDef = {
    title: 'Batch Wise Sales And Profit', group: 'Item/ Stock report',
    filters: <Sel id="rpBsItem" label="Item" value={item} onChange={setItem} opts={[['', 'All items'], ...its]} />,
    kpis: [['Sold', inr2f(sum('sale').toFixed(2))], ['Cost', inr2f(sum('cost').toFixed(2))], ['Profit', inr2f(sum('profit').toFixed(2)), sum('profit').isNegative() ? 'pscl neg' : 'pscl pos'], ['Margin', margin(sum('profit'), sum('sale'))]],
    cols: [{ h: 'Item', w: 30 }, { h: 'Batch', w: 14 }, { h: 'Expiry', w: 10 }, { h: 'Sold, after returns', n: true }, { h: 'Sale value', n: true }, { h: 'Cost', n: true }, { h: 'Profit', n: true }, { h: 'Margin', n: true }],
    rows: A.map((r) => ({ k: `${r.itemId}|${r.no}`, c: [r.item, r.no, batchMonth(r.expiry), packQtyText(r.qty, r.unit, packOf(r)), inr2f(r.sale), inr2f(r.cost), inr2f(r.profit), margin(r.profit, r.sale)] })),
    foot: ['Total', '', '', '', formatInr2(sum('sale')), formatInr2(sum('cost')), formatInr2(sum('profit')), margin(sum('profit'), sum('sale'))], empty: 'No batches sold in this period.',
    note: 'Sale value is before GST, after each line’s discount, as in Party wise Profit & Loss. Cost comes from the same lots as the stock value. Returns are taken off. Items you don’t track by batch aren’t listed.',
    click: (k) => nav('/items', { state: { open: k.split('|')[0] } }),
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(printable(def))} />;
}

