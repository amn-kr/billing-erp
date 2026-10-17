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

/** Who a token is for, "<user>|<business>": the same for the token renewed every 15 minutes, different after switching shop or person. */
export const tokenOwner = (tok: string | null): string => {
  if (!tok) return '';
  try { const c = JSON.parse(atob(tok.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string; bid?: string | null }; return `${c.sub}|${c.bid}`; } catch { return ''; }
};

/**
 * Query key part for data of the signed-in person and shop: who the token is for, not the token itself.
 * A renewed token must not leave the app without data for a moment (it was drawn again from scratch).
 * A token that can't be read keeps itself as the key, as before.
 */
export const ownerKey = (tok: string | null): string | null => tokenOwner(tok) || tok;
