/**
 * "View history" for a saved or cancelled document: the edits it had, newest first, in the
 * prototype's small window (#slm). One box per edit with what changed, and when and by whom on its
 * right; a box of more than 3 lines shows 2 and "Show More". Built only from the prototype's own
 * classes (.dgterms box, .slcl lines, .lnk link, .ptempty). Reading needs no passcode.
 */
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { SlModalProps } from '../features/sales/SlModal';
import { ui } from '../styles/uiSize';

/** Which kind of document (the API's /history/:type/:id). */
export type HistoryType = 'sales' | 'receipt' | 'purchase' | 'payment-made' | 'expense' | 'bank-entry' | 'stock-adjustment' | 'stock-transfer';
export interface HistoryEntry { id: string; at: string; when: string; user: string; lines: string[]; details: boolean }
export interface DocHistory { type: string; number: string; entries: HistoryEntry[] }

/** The row menu's item, last in the list as in the prototype's sales menu. */
export const HIST_ACTION: [string, string] = ['hist', 'View history'];

function Box({ e }: { e: HistoryEntry }) {
  const [all, setAll] = useState(false);
  const cut = e.lines.length > 3 && !all;
  return (
    <div className="dgterms" data-hist={e.id}>
      <div style={{ display: 'flex', gap: ui.sp(14), alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <ul className="slcl" style={{ flex: 1, minWidth: 0 }}>{(cut ? e.lines.slice(0, 2) : e.lines).map((l, k) => <li key={k}>{l}</li>)}</ul>
        <div style={{ flex: 'none', textAlign: 'right', fontSize: ui.fs(12.5) }}><b>{e.when}</b><small className="mu" style={{ display: 'block' }}>{e.user}</small></div>
      </div>
      {cut ? <button type="button" className="lnk" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(true)}>Show More</button> : null}
    </div>
  );
}

export function historyModal(h: DocHistory): SlModalProps {
  return {
    title: `Edit History for ${h.type} #${h.number}`,
    // the prototype's width for a list window (#iqm, Import from quotation)
    wide: 'min(640px,100%)',
    body: h.entries.length
      ? <div id="ehList" style={{ display: 'flex', flexDirection: 'column', gap: ui.sp(10), maxHeight: ui.h('min(60vh, 520px)'), overflow: 'auto' }}>{h.entries.map((e) => <Box e={e} key={e.id} />)}</div>
      : <div className="ptempty" id="ehList">No edits yet</div>,
  };
}

/** Opens a document's history in the page's #slm window (`show`), or says why it could not. */
export async function openHistory(type: HistoryType, id: string, show: (m: SlModalProps) => void, toast: (m: string) => void) {
  try {
    show(historyModal(await api<DocHistory>(`/history/${type}/${id}`)));
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Could not open the history.');
  }
}
