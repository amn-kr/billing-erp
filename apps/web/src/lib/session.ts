import { create } from 'zustand';

/** The access token lives only in memory; the refresh token is an httpOnly cookie the page cannot read. */
interface SessionState {
  accessToken: string | null;
  setToken: (t: string | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  accessToken: null,
  setToken: (accessToken) => set({ accessToken }),
}));
