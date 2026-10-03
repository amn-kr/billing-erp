import { useEffect, useState, type ReactNode } from 'react';
import { refreshSession } from '../lib/api';

/** On page load, try to resume the session from the refresh cookie before showing anything. */
export function Boot({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void refreshSession().finally(() => setReady(true));
  }, []);
  return ready ? <>{children}</> : null;
}
