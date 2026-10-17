import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { PAL, type PalId } from './palette';

export type PopId = 'bellPop' | 'orgPop' | 'qcPop' | 'avPop';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
export const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

const savedPal = (): PalId => {
  const s = read('erp-pal');
  return (PAL.some((p) => p.id === s) ? s : 'ledger') as PalId;
};

/** Black (most messages), green (a document saved) or red (a save that failed). */
export type ToastKind = 'info' | 'ok' | 'error';
export interface ToastMsg { text: string; n: number; kind: ToastKind }

interface ShellState {
  /** waiting to be shown; the Toast takes it out once it shows it */
  toast: ToastMsg | null;
  pop: PopId | null;
  /** colour combination, remembered on this device (Settings › General › Display) */
  palId: PalId;
  sideOpen: boolean;
  mini: boolean;
  dialog: 'so' | null;
  showToast: (text: string, kind?: ToastKind) => void;
  setPop: (p: PopId | null) => void;
  choosePal: (id: PalId) => void;
  setSideOpen: (open: boolean) => void;
  toggleMini: () => void;
  setDialog: (d: 'so' | null) => void;
  closeAll: () => void;
}

let toastN = 0;
export const useShell = create<ShellState>((set, get) => ({
  toast: null,
  pop: null,
  palId: savedPal(),
  sideOpen: false,
  mini: !!read('erp-mini') && typeof window !== 'undefined' && window.innerWidth > 980,
  dialog: null,
  showToast: (text, kind = 'info') => set({ toast: { text, n: ++toastN, kind } }),
  setPop: (pop) => set({ pop }),
  choosePal: (palId) => {
    write('erp-pal', palId);
    set({ palId, toast: { text: `${PAL.find((p) => p.id === palId)!.name} applied`, n: ++toastN, kind: 'info' } });
  },
  setSideOpen: (sideOpen) => set({ sideOpen }),
  toggleMini: () => {
    const mini = !get().mini;
    write('erp-mini', mini ? '1' : '');
    set({ mini });
  },
  setDialog: (dialog) => set({ dialog }),
  closeAll: () => set({ pop: null, sideOpen: false }),
}));

/** Prototype wording for screens that are not rebuilt yet. */
export const soon = (what: string) => useShell.getState().showToast(`${what} screen is coming next`);

/** Whether this device is online (header "Offline" label, Settings › General › Cloud sync status). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export { read as readLocal };
