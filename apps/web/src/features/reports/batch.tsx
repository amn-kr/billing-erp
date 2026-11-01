/**
 * Item Batch Report (Features › batch_expiry; owner-approved mock, 1 Nov 2026): the stock of every batch with its
 * expiry and value, from the same lot calculation as the stock value. Filters: expired, expiring within 30, 60, 90 days.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { batchMonth, expiryLabel, formatQty, matchesExpiry, money, sumValues, type BatchRow, type ExpiryFilter } from '@billing/shared';
import { api } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { ExpiryTag } from '../items/BatchCard';
import { RpShell, type RpDef } from './Shell';
import type { RpProps } from './ReportsPage';
import { ui } from '../../styles/uiSize';

interface Row extends BatchRow { itemId: string; item: string; code: string; unit: string }
const CHIPS: [ExpiryFilter, string][] = [['all', 'All'], ['expired', 'Expired'], [30, '30 days'], [60, '60 days'], [90, '90 days']];

export function BatchReport(props: RpProps) {
  const on = today();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['items', 'batch-report'], queryFn: () => api<Row[]>('/reports/batches') });
  const [f, setF] = useState<ExpiryFilter>('all');
  if (!q.data) return null;
  const A = q.data.filter((r) => matchesExpiry(r.expiry, on, f));
  const value = (L: Row[]) => sumValues(L.map((r) => r.value));
  const qty = A.reduce((a, r) => a.plus(r.qty), money(0));
  const def: RpDef = {
    title: 'Item Batch Report', group: 'Item/ Stock report', period: false, sub: f === 'all' ? '' : CHIPS.find((c) => c[0] === f)![1],
    filters: <div className="seg2" id="rpBxF" style={{ marginBottom: ui.sp(4) }}>{CHIPS.map(([k, label]) => <button type="button" key={String(k)} data-bxf={String(k)} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{label}</button>)}</div>,
    kpis: [['Stock value', inr2f(value(q.data))], ['Expired', inr2f(value(q.data.filter((r) => matchesExpiry(r.expiry, on, 'expired')))), 'pscl neg'], ['Expiring in 90 days', inr2f(value(q.data.filter((r) => matchesExpiry(r.expiry, on, 90))))], ['Batches', String(q.data.filter((r) => r.id).length)]],
    cols: [{ h: 'Item', w: 30 }, { h: 'Batch', w: 14 }, { h: 'Mfg', w: 10 }, { h: 'Expiry', w: 10 }, { h: '', w: 12 }, { h: 'In stock', n: true }, { h: 'Rate', n: true }, { h: 'Value', n: true }],
    rows: A.map((r) => ({ k: r.itemId, c: [r.item, r.no, batchMonth(r.mfg), batchMonth(r.expiry), expiryLabel(r.expiry, on), `${formatQty(r.qty)} ${r.unit}`, inr2f(r.rate), inr2f(r.value)], h: { 4: <ExpiryTag expiry={r.expiry} on={on} /> } })),
    foot: ['Total', '', '', '', '', formatQty(qty), '', inr2f(value(A))], empty: f === 'all' ? 'No items with batches have stock yet.' : 'No batches match.',
    note: 'Values use the same purchase rates as the stock value. Items you don’t track by batch aren’t listed. Click a row to open the item.',
    click: (k) => nav('/items', { state: { open: k } }),
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}
