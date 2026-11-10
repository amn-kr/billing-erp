/**
 * What the title bar's update button shows, and how it changes (no Electron here, so it is unit-tested).
 *   idle         "Check for updates"
 *   checking     "Checking…"
 *   latest       "Up to date" (for a few seconds, then idle again)
 *   downloading  "Downloading v0.1.1… 45%"
 *   ready        "Restart to update to v0.1.1"
 *   error        "Couldn't check for updates" (only after a click; quiet background checks stay idle)
 *   unavailable  the app is not installed (developing, tests): updates come only to the installed app
 */
export type UpdateState =
  | { kind: 'idle' | 'checking' | 'latest' | 'unavailable' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

/** What electron-updater (or a stand-in) reports. */
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'none' }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

/**
 * The next state. `manual`: the person clicked "Check for updates" (only then are "Up to date" and
 * errors shown; a quiet check at start or every 4 hours never interrupts).
 */
export function nextState(s: UpdateState, e: UpdateEvent, manual: boolean): UpdateState {
  // a downloaded update stays ready until the app restarts, whatever later checks say
  if (s.kind === 'ready') return s;
  switch (e.type) {
    case 'checking':
      return s.kind === 'downloading' ? s : manual ? { kind: 'checking' } : s;
    case 'available':
      return { kind: 'downloading', version: e.version, percent: 0 };
    case 'progress':
      return s.kind === 'downloading' ? { ...s, percent: Math.max(0, Math.min(100, Math.round(e.percent))) } : s;
    case 'none':
      return manual ? { kind: 'latest' } : s.kind === 'checking' ? { kind: 'idle' } : s;
    case 'downloaded':
      return { kind: 'ready', version: e.version };
    case 'error':
      // a failed download goes back to idle; it is tried again at the next check
      return manual ? { kind: 'error', message: e.message } : { kind: 'idle' };
  }
}

/** Plain words for the button and its tooltip. */
export function label(s: UpdateState): { text: string; title: string; action: 'check' | 'install' | 'none' } {
  switch (s.kind) {
    case 'idle': return { text: 'Check for updates', title: 'Look for a newer version of the app', action: 'check' };
    case 'checking': return { text: 'Checking…', title: 'Looking for a newer version', action: 'none' };
    case 'latest': return { text: 'Up to date', title: 'You have the newest version', action: 'check' };
    case 'downloading': return { text: `Downloading v${s.version}… ${s.percent}%`, title: 'The new version downloads in the background; keep working', action: 'none' };
    case 'ready': return { text: `Restart to update to v${s.version}`, title: 'Save any bill you are typing first. The app closes, updates and opens again.', action: 'install' };
    case 'error': return { text: 'Couldn’t check — try again', title: s.message || 'No internet, or the update server did not answer', action: 'check' };
    case 'unavailable': return { text: 'Updates: installed app only', title: 'This copy is not installed, so it cannot update itself', action: 'none' };
  }
}
