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

interface ShellState {
  toast: { text: string; n: number } | null;
  pop: PopId | null;
  /** colour combination, remembered on this device (Settings › General › Display) */
  palId: PalId;
  sideOpen: boolean;
  mini: boolean;
  dialog: 'so' | null;
  showToast: (text: string) => void;
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
  showToast: (text) => set({ toast: { text, n: ++toastN } }),
  setPop: (pop) => set({ pop }),
  choosePal: (palId) => {
    write('erp-pal', palId);
    set({ palId, toast: { text: `${PAL.find((p) => p.id === palId)!.name} applied`, n: ++toastN } });
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
