import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { refreshOwner, toSignIn } from './api';
import { OwnerApp } from './OwnerApp';

/**
 * /owner: the panel, drawn on its own (the shop app is never started here, so none of its styles are on the page). Without a
 * panel sign-in (a shop user who typed /owner, or after 12 hours) it goes to the sign-in page.
 */
export async function startOwner(root: HTMLElement): Promise<void> {
  if (!(await refreshOwner())) return toSignIn();
  createRoot(root).render(
    <StrictMode>
      <OwnerApp />
    </StrictMode>,
  );
}
