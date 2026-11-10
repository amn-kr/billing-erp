/**
 * Updates (installed app). The title bar shows the version and a "Check for updates" button
 * (owner, 10 Nov 2026). The app also checks quietly when it starts and every 4 hours. A newer version
 * on GitHub Releases downloads in the background; the button then says "Restart to update to vX".
 *
 * BILLING_FAKE_UPDATE (tests only): a stand-in instead of GitHub — "latest", "offline", or a version
 * number such as "0.1.1" (found, downloaded; "restart" is recorded instead of done).
 */
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { label, nextState, type UpdateEvent, type UpdateState } from './updateState';

/** the app's version, from package.json (build.mjs); the same number GitHub Releases uses */
declare const __APP_VERSION__: string;

const EVERY = 4 * 60 * 60 * 1000;
/** how long "Up to date" stays before the button says "Check for updates" again */
const LATEST_FOR = 6000;

interface Backend { check(): Promise<unknown>; install(): void }

function realBackend(emit: (e: UpdateEvent) => void): Backend {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => emit({ type: 'checking' }));
  autoUpdater.on('update-available', (i) => emit({ type: 'available', version: i.version }));
  autoUpdater.on('download-progress', (p) => emit({ type: 'progress', percent: p.percent }));
  autoUpdater.on('update-not-available', () => emit({ type: 'none' }));
  autoUpdater.on('update-downloaded', (i) => emit({ type: 'downloaded', version: i.version }));
  autoUpdater.on('error', (err) => emit({ type: 'error', message: err?.message ?? String(err) }));
  return { check: () => autoUpdater.checkForUpdates(), install: () => autoUpdater.quitAndInstall() };
}

function fakeBackend(mode: string, emit: (e: UpdateEvent) => void): Backend {
  const later = (ms: number, e: UpdateEvent) => new Promise<void>((r) => setTimeout(() => { emit(e); r(); }, ms));
  return {
    async check() {
      emit({ type: 'checking' });
      if (mode === 'latest') return later(300, { type: 'none' });
      if (mode === 'offline') return later(300, { type: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
      await later(300, { type: 'available', version: mode });
      await later(300, { type: 'progress', percent: 50 });
      await later(1500, { type: 'downloaded', version: mode });
    },
    install() { (globalThis as unknown as { restartedToUpdate?: boolean }).restartedToUpdate = true; },
  };
}

export interface Updates {
  version: string;
  state(): UpdateState;
  view(): { version: string; state: UpdateState; button: ReturnType<typeof label> };
  /** the button: check now (shows Checking…, Up to date or an error) */
  check(): void;
  install(): void;
  onChange(fn: () => void): void;
}

export function startUpdates(): Updates {
  const fake = process.env.BILLING_FAKE_UPDATE;
  let state: UpdateState = app.isPackaged || fake ? { kind: 'idle' } : { kind: 'unavailable' };
  let manual = false;
  let latestTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners: (() => void)[] = [];
  const changed = () => listeners.forEach((f) => f());

  const emit = (e: UpdateEvent) => {
    if (state.kind === 'unavailable') return;
    const before = state;
    state = nextState(state, e, manual);
    // the check is over once it found something, nothing, or failed
    if (e.type === 'none' || e.type === 'error' || e.type === 'available') manual = false;
    if (state.kind === 'latest' && before.kind !== 'latest') {
      clearTimeout(latestTimer);
      latestTimer = setTimeout(() => { if (state.kind === 'latest') { state = { kind: 'idle' }; changed(); } }, LATEST_FOR);
    }
    if (state !== before) changed();
  };

  const backend: Backend | null = fake ? fakeBackend(fake, emit) : app.isPackaged && !process.env.BILLING_NO_UPDATES ? realBackend(emit) : null;
  const run = (byClick: boolean) => {
    if (!backend || state.kind === 'checking' || state.kind === 'downloading' || state.kind === 'ready') return;
    manual = byClick;
    backend.check().catch((err: unknown) => emit({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  };

  if (backend && !fake) {
    run(false);
    setInterval(() => run(false), EVERY);
  }

  const version = __APP_VERSION__;
  return {
    version,
    state: () => state,
    view: () => ({ version, state, button: label(state) }),
    check: () => run(true),
    install: () => { if (state.kind === 'ready') backend?.install(); },
    onChange: (fn) => { listeners.push(fn); },
  };
}
