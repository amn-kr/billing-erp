/**
 * Item Batch Report (Settings › Items › Batch No.; owner-approved mock, 1 Nov 2026): the stock of every batch with its
 * expiry and value, from the same lot calculation as the stock value. Filters: expired, expiring within 30, 60, 90 days.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { expiryLabel, formatQty, packQtyText, matchesExpiry, money, sumValues, type BatchRow, type ExpiryFilter } from '@billing/shared';
import { api } from '../../lib/api';
import { inr2f } from '../../lib/format';
import { today } from '../../lib/time';
import { useBatchView, useFeature } from '../../lib/features';
import { ExpiryTag } from '../items/BatchCard';
import { RpShell, type RpDef } from './Shell';
import type { RpProps } from './ReportsPage';
import { ui } from '../../styles/uiSize';

interface Row extends BatchRow { itemId: string; item: string; code: string; unit: string; packUnit?: string; packSize?: string | null }
const CHIPS: [ExpiryFilter, string][] = [['all', 'All'], ['expired', 'Expired'], [30, '30 days'], [60, '60 days'], [90, '90 days']];

export function BatchReport(props: RpProps) {
  const on = today();
  const showMrp = useFeature('mrp');
  const v = useBatchView();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['items', 'batch-report'], queryFn: () => api<Row[]>('/reports/batches') });
  const [f, setF] = useState<ExpiryFilter>('all');
  if (!q.data) return null;
  const A = q.data.filter((r) => matchesExpiry(r.expiry, on, f));
  const value = (L: Row[]) => sumValues(L.map((r) => r.value));
  const qty = A.reduce((a, r) => a.plus(r.qty), money(0));
  const def: RpDef = {
    title: 'Item Batch Report', group: 'Item/ Stock report', period: false, sub: f === 'all' ? '' : CHIPS.find((c) => c[0] === f)![1],
    filters: !v.exp ? undefined : <div className="seg2" id="rpBxF" style={{ marginBottom: ui.sp(4) }}>{CHIPS.map(([k, label]) => <button type="button" key={String(k)} data-bxf={String(k)} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{label}</button>)}</div>,
    kpis: [['Stock value', inr2f(value(q.data))], ...(v.exp ? ([['Expired', inr2f(value(q.data.filter((r) => matchesExpiry(r.expiry, on, 'expired')))), 'pscl neg'], ['Expiring in 90 days', inr2f(value(q.data.filter((r) => matchesExpiry(r.expiry, on, 90))))]] as [string, string, string?][]) : []), ['Batches', String(q.data.filter((r) => r.id).length)]],
    cols: [{ h: 'Item', w: 30 }, { h: v.word('batch', 'Batch'), w: 14 }, ...(v.mfg ? [{ h: v.word('mfg', 'Mfg'), w: 10 }] : []), ...(v.exp ? [{ h: v.word('exp', 'Expiry'), w: 10 }, { h: '', w: 12 }] : []), ...(showMrp ? [{ h: v.word('mrp', 'MRP'), n: true }] : []), { h: 'In stock', n: true }, { h: 'Rate', n: true }, { h: 'Value', n: true }],
    rows: A.map((r) => ({ k: r.itemId, c: [r.item, r.no, ...(v.mfg ? [v.mfgText(r.mfg)] : []), ...(v.exp ? [v.expText(r.expiry), expiryLabel(r.expiry, on)] : []), ...(showMrp ? [r.mrp ? inr2f(r.mrp) : '—'] : []), r.packUnit && r.packSize ? packQtyText(r.qty, r.unit, { packUnit: r.packUnit, packSize: r.packSize }) : `${formatQty(r.qty)} ${r.unit}`, inr2f(r.rate), inr2f(r.value)], h: v.exp ? { [v.mfg ? 4 : 3]: <ExpiryTag expiry={r.expiry} on={on} /> } : {} })),
    foot: ['Total', '', ...(v.mfg ? [''] : []), ...(v.exp ? ['', ''] : []), ...(showMrp ? [''] : []), formatQty(qty), '', inr2f(value(A))], empty: f === 'all' ? 'No items with batches have stock yet.' : 'No batches match.',
    note: 'Values use the same purchase rates as the stock value. Items you don’t track by batch aren’t listed. Click a row to open the item.',
    click: (k) => nav('/items', { state: { open: k } }),
  };
  return <RpShell o={def} p={props.p} setP={props.setP} onToggle={props.onToggle} onPrint={() => props.onPrint(def)} />;
}
