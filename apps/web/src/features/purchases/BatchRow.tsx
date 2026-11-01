/**
 * A tracked item's second row on a purchase document (Features › batch_expiry; owner-approved mock,
 * 1 Nov 2026). A bill takes the batch no., mfg and expiry; a debit note picks the batch it comes out of.
 */
import { useQuery } from '@tanstack/react-query';
import { batchDay, batchMonth, formatQty, parseBatchDate, type BatchRow as Row } from '@billing/shared';
import { api } from '../../lib/api';
import { ui } from '../../styles/uiSize';

export interface LineBatch { batchNo: string; mfg: string; expiry: string; batchId: string }
export const useItemBatches = (itemId: string | null | undefined, on: boolean) =>
  useQuery({ queryKey: ['item', itemId, 'batches'], queryFn: () => api<{ rows: Row[]; shortQty: string }>(`/items/${itemId}/batches`), enabled: on && !!itemId });
/** "A123 · Exp Mar 2027 · 3 in stock" */
export const batchOption = (b: Row) => `${b.no}${b.expiry ? ` · Exp ${batchMonth(b.expiry)}` : ''} · ${formatQty(b.qty)} in stock`;

const LBL = { display: 'flex', alignItems: 'center', gap: ui.sp(6), fontSize: ui.fs(12), color: 'var(--t2)', fontWeight: 500 } as const;
const BOX = (w: number) => ({ width: ui.w(w), height: ui.h(32), padding: ui.sp('0 8px'), margin: 0 });

export function BatchRowCells({ i, cols, kind, itemId, against, b, onChange, onKeyDown }: {
  i: number; cols: number; kind: 'bill' | 'debit_note'; itemId: string; against: boolean; b: LineBatch;
  onChange: (f: keyof LineBatch, v: string) => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const rows = useItemBatches(itemId, kind === 'debit_note').data?.rows ?? [];
  const exp = parseBatchDate(b.expiry, 'expiry');
  return (
    <tr className="bxr" data-bx={i}>
      <td></td>
      <td colSpan={cols} style={{ padding: ui.sp('4px 10px 10px') }}>
        <div style={{ display: 'flex', gap: ui.sp(14), alignItems: 'center', flexWrap: 'wrap' }}>
          {kind === 'bill' ? (
            <>
              <label style={LBL}>Batch no.<input className="fi" data-bf="batchNo" style={BOX(130)} value={b.batchNo} placeholder="e.g. A123" autoComplete="off" aria-label={`Batch no. for row ${i + 1}`} onChange={(e) => onChange('batchNo', e.target.value)} onKeyDown={onKeyDown} /></label>
              <label style={LBL}>Mfg<input className="fi" data-bf="mfg" style={BOX(84)} value={b.mfg} placeholder="MM/YY" autoComplete="off" aria-label={`Mfg date for row ${i + 1}`} onChange={(e) => onChange('mfg', e.target.value)} onKeyDown={onKeyDown} /></label>
              <label style={LBL}>Expiry<input className="fi" data-bf="expiry" style={BOX(84)} value={b.expiry} placeholder="MM/YY" autoComplete="off" aria-label={`Expiry for row ${i + 1}`} onChange={(e) => onChange('expiry', e.target.value)} onKeyDown={onKeyDown} /></label>
              <span className={exp === undefined ? 'xperr' : 'mu'} data-bxmsg style={{ fontSize: ui.fs(12), margin: 0 }}>{exp === undefined ? 'Type the expiry like 03/27' : exp ? `Expires ${batchDay(exp)}` : ''}</span>
            </>
          ) : (
            <label style={LBL}>Batch<select className="fi" data-bf="batchId" style={{ ...BOX(320), width: 'auto' }} value={b.batchId} aria-label={`Batch for row ${i + 1}`} onChange={(e) => onChange('batchId', e.target.value)}>
              <option value="">{against ? 'Same as the bill' : 'No batch'}</option>
              {rows.filter((r) => r.id).map((r) => <option value={r.id!} key={r.id}>{batchOption(r)}</option>)}
            </select></label>
          )}
        </div>
      </td>
    </tr>
  );
}
