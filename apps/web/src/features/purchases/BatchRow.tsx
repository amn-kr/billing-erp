/**
 * A purchase document's batch cells (Settings › Items › Batch No.): their own columns in the item row
 * (owner, 8 Nov 2026). A bill takes the batch no., mfg, expiry and MRP; a debit note picks the batch it
 * comes out of. An item that doesn't track batches gets empty cells, so the columns stay in line.
 */
import { useQuery } from '@tanstack/react-query';
import { batchDay, formatQty, parseBatchDate, type BatchRow as Row, type BatchView } from '@billing/shared';
import { api } from '../../lib/api';
import { useBatchView } from '../../lib/features';
import { ui } from '../../styles/uiSize';
import type { ColOpts } from '../sales/editor/columns';

export interface LineBatch { batchNo: string; mfg: string; expiry: string; batchId: string; mrp: string }
export const useItemBatches = (itemId: string | null | undefined, on: boolean) =>
  useQuery({ queryKey: ['item', itemId, 'batches'], queryFn: () => api<{ rows: Row[]; shortQty: string }>(`/items/${itemId}/batches`), enabled: on && !!itemId });
/** "A123 · Exp Mar 2027 · 3 in stock" */
export const batchOption = (b: Row, v: BatchView) => `${b.no}${b.expiry ? ` · ${v.word('exp', 'Exp')} ${v.expText(b.expiry)}` : ''} · ${formatQty(b.qty)} in stock`;

const NOTE = { display: 'block', fontSize: ui.fs(11), margin: 0, padding: ui.sp('1px 0 0 10px') } as const;

export function BatchCells({ i, tracked, o, kind, itemId, against, b, onChange, onKeyDown, packUnit }: {
  i: number; tracked: boolean; o: ColOpts; kind: 'bill' | 'debit_note'; itemId: string; against: boolean; b: LineBatch; /** Settings › Items › MRP and Pack: the MRP is per this pack */ packUnit?: string;
  onChange: (f: keyof LineBatch, v: string) => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const rows = useItemBatches(itemId, tracked && kind === 'debit_note').data?.rows ?? [];
  const v = useBatchView();
  const exp = tracked && o.exp ? parseBatchDate(b.expiry, 'expiry') : null;
  const empty = (on?: boolean) => (on ? <td className="ro l"></td> : null);
  if (!tracked) return <>{empty(o.batch)}{empty(o.mfg)}{empty(o.exp)}{empty(o.mrp)}</>;
  if (kind === 'debit_note') {
    return (
      <td><select className="gi" data-bf="batchId" value={b.batchId} aria-label={`Batch for row ${i + 1}`} onChange={(e) => onChange('batchId', e.target.value)}>
        <option value="">{against ? 'Same as the bill' : 'No batch'}</option>
        {rows.filter((r) => r.id).map((r) => <option value={r.id!} key={r.id}>{batchOption(r, v)}</option>)}
      </select></td>
    );
  }
  return (
    <>
      <td><input className="gi" data-bf="batchNo" value={b.batchNo} placeholder="e.g. A123" autoComplete="off" aria-label={`Batch no. for row ${i + 1}`} onChange={(e) => onChange('batchNo', e.target.value)} onKeyDown={onKeyDown} /></td>
      {o.mfg ? <td><input className="gi" data-bf="mfg" value={b.mfg} placeholder={v.hint('mfg')} autoComplete="off" aria-label={`Mfg date for row ${i + 1}`} onChange={(e) => onChange('mfg', e.target.value)} onKeyDown={onKeyDown} /></td> : null}
      {o.exp ? <td><input className="gi" data-bf="expiry" value={b.expiry} placeholder={v.hint('expiry')} autoComplete="off" aria-label={`Expiry for row ${i + 1}`} onChange={(e) => onChange('expiry', e.target.value)} onKeyDown={onKeyDown} />
        {exp === undefined || exp ? <small className={exp === undefined ? 'xperr' : 'mu'} data-bxmsg style={NOTE}>{exp === undefined ? 'Type the expiry like 03/27' : `${v.word('exp', 'Expires')} ${v.expFormat === 'month' ? batchDay(exp!) : v.expDay(exp!)}`}</small> : null}</td> : null}
      {o.mrp ? <td><input className="gi n" data-bf="mrp" value={b.mrp} placeholder="0.00" inputMode="decimal" autoComplete="off" aria-label={`MRP for row ${i + 1}`} onChange={(e) => onChange('mrp', e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={onKeyDown} />
        {packUnit ? <small className="mu" data-mrpnote style={NOTE}>per {packUnit}</small> : null}</td> : null}
    </>
  );
}
