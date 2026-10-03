import { create } from 'zustand';

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

interface ShellState {
  toast: { text: string; n: number } | null;
  pop: PopId | null;
  pal: boolean;
  sideOpen: boolean;
  mini: boolean;
  dialog: 'so' | null;
  showToast: (text: string) => void;
  setPop: (p: PopId | null) => void;
  setPal: (open: boolean) => void;
  setSideOpen: (open: boolean) => void;
  toggleMini: () => void;
  setDialog: (d: 'so' | null) => void;
  closeAll: () => void;
}

let toastN = 0;
export const useShell = create<ShellState>((set, get) => ({
  toast: null,
  pop: null,
  pal: false,
  sideOpen: false,
  mini: !!read('erp-mini') && typeof window !== 'undefined' && window.innerWidth > 980,
  dialog: null,
  showToast: (text) => set({ toast: { text, n: ++toastN } }),
  setPop: (pop) => set({ pop }),
  setPal: (pal) => set({ pal }),
  setSideOpen: (sideOpen) => set({ sideOpen }),
  toggleMini: () => {
    const mini = !get().mini;
    write('erp-mini', mini ? '1' : '');
    set({ mini });
  },
  setDialog: (dialog) => set({ dialog }),
  closeAll: () => set({ pop: null, pal: false, sideOpen: false }),
}));

/** Prototype wording for screens that are not rebuilt yet. */
export const soon = (what: string) => useShell.getState().showToast(`${what} screen is coming next`);

export { read as readLocal };
