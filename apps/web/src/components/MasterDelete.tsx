/**
 * Delete and Inactive for items and parties (owner, Oct 2026). Delete sits in Edit item / Edit party, like
 * the prototype's red Delete in its expense window. A never-used one gets the prototype's slModal
 * "Delete …?" box; a used one gets the server's reason in a "Can’t delete …" box that offers Make inactive.
 * No passcode: only documents have one. The lists end with "Show inactive", whose rows have Make active.
 */
import { useRef, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { SlModal, type SlModalProps } from '../features/sales/SlModal';
import { useShell } from '../features/shell/store';

export type Master = 'item' | 'party';
const PATH: Record<Master, string> = { item: 'items', party: 'parties' };
/** what the lists, the card and the pickers read */
const KEYS: Record<Master, string[]> = { item: ['items', 'item', 'items-inactive', 'catalogue'], party: ['parties', 'parties-inactive', 'party-tx'] };

export interface MasterRow { id: string; name: string }

/** Ask to delete one item or party: `note` is what goes with it ("its opening stock of 25 PCS"); onGone runs once it is deleted or made inactive. */
export function useMasterDelete(what: Master, onGone: () => void) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [m, setM] = useState<SlModalProps | null>(null);
  const busy = useRef(false);
  const refresh = () => Promise.all(KEYS[what].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const once = (run: () => Promise<void>) => async () => {
    if (busy.current) return;
    busy.current = true;
    try { await run(); } finally { busy.current = false; }
  };
  const fail = (e: unknown, text: string) => showToast(e instanceof ApiError ? e.message : text, 'error');

  async function makeInactive(row: MasterRow) {
    try {
      await api(`/${PATH[what]}/${row.id}/archive`, { method: 'POST' });
      setM(null);
      showToast(`${row.name} is now inactive`, 'ok');
      await refresh();
      onGone();
    } catch (e) { fail(e, 'Could not make it inactive.'); }
  }

  async function ask(row: MasterRow, note = '') {
    let u: { canDelete: boolean; message: string };
    try {
      u = await api(`/${PATH[what]}/${row.id}/usage`);
    } catch (e) { return fail(e, 'Could not check this. Try again.'); }
    if (!u.canDelete) {
      return setM({ title: `Can’t delete ${row.name}`, body: <p className="slcl" style={{ margin: 0 }}>{u.message}</p>, ok: 'Make inactive', cancel: 'Close', onOk: once(() => makeInactive(row)) });
    }
    setM({
      title: `Delete ${row.name}?`, danger: true, ok: `Delete ${what}`,
      body: <p className="slcl" style={{ margin: 0 }}>This removes the {what}{note ? ` and ${note}` : ''} for good. It isn’t used in any transaction.</p>,
      onOk: once(async () => {
        try {
          await api(`/${PATH[what]}/${row.id}/delete`, { body: {} });
          setM(null);
          showToast(`${row.name} deleted`, 'ok');
          await refresh();
          onGone();
        } catch (e) { fail(e, 'Could not delete it.'); }
      }),
    });
  }

  return { ask, modal: <SlModal m={m} onClose={() => setM(null)} /> };
}

/**
 * "Show inactive" at the bottom of the Items / Parties list (only when there are inactive ones): inactive
 * rows with an "Inactive" tag and Make active. `keep` picks those the list's own filter shows; `nameStyle`
 * is the list's own name style (items: as typed, parties: capitals).
 */
export function InactiveList<R extends MasterRow>({ what, keep, nameStyle }: { what: Master; keep: (r: R) => boolean; nameStyle?: CSSProperties }) {
  const qc = useQueryClient();
  const { showToast } = useShell();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: [`${PATH[what]}-inactive`], queryFn: () => api<R[]>(`/${PATH[what]}?archived=true`) });
  const rows = (list.data ?? []).filter(keep);
  if (!rows.length) return null;
  async function makeActive(r: R) {
    try {
      await api(`/${PATH[what]}/${r.id}/restore`, { method: 'POST' });
      // the message as soon as it is saved; the lists follow
      showToast(`${r.name} is active again`, 'ok');
      await Promise.all(KEYS[what].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not make it active.', 'error'); }
  }
  return (
    <>
      <div style={{ padding: '10px 14px' }}><button className="lnk" type="button" id={`${what}Inactive`} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide inactive' : `Show inactive (${rows.length})`}</button></div>
      {open && rows.map((r) => (
        <div className="ptr" data-inactive={r.id} key={r.id} style={{ cursor: 'default', alignItems: 'center' }}>
          <span className="ptn" style={{ color: 'var(--t2)', ...nameStyle }}>{r.name}{' '}<span className="st q">Inactive</span></span>
          <button className="btn sm" type="button" data-mkactive={r.id} onClick={() => void makeActive(r)}>Make active</button>
        </div>
      ))}
    </>
  );
}
