/**
 * The Delete box for a saved document or payment (the Sales list's Delete, #34): the small window
 * (#slm) says what happens, then the passcode box (when it is on) and the server's delete. The
 * record is hidden from the lists but kept; the server refuses what can't be deleted, with the reason.
 */
import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { cancelAsk, deleteAsk, withPasscode } from '../settings/passcode';
import type { SlModalProps } from './SlModal';

export const KEPT = 'It is hidden from your lists but kept safely in your records. Nothing is erased.';

export function deleteModal(o: {
  qc: QueryClient; number: string; sub: string; what: string; url: string; keys: string[]; body: ReactNode;
  /** "Cancel" words instead of "Delete" (the Purchase bills list); it does the same */
  cancelWords?: boolean;
  done: () => void; toast: (m: string) => void;
}): SlModalProps {
  const verb = o.cancelWords ? 'Cancel' : 'Delete';
  return {
    title: `${verb} ${o.number}?`, sub: o.sub, ok: `${verb} ${o.what}`, danger: true,
    body: <p className="slcl" style={{ margin: 0 }}>{KEPT} {o.body}</p>,
    onOk: async () => {
      try {
        const ask = o.cancelWords ? cancelAsk(o.number, o.what) : deleteAsk(o.number, o.what);
        if (!(await withPasscode(o.qc, ask, (h) => api(o.url, { method: 'POST', body: {}, headers: h })))) return;
        o.done();
        await Promise.all(o.keys.map((k) => o.qc.invalidateQueries({ queryKey: [k] })));
        o.toast(`${o.number} ${o.cancelWords ? 'cancelled' : 'deleted'}`);
      } catch (e) { o.toast(e instanceof ApiError ? e.message : `Could not ${verb.toLowerCase()} ${o.number}.`); }
    },
  };
}
