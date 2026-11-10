/**
 * The Windows app (Phase 6, step 1: online). One window that shows the web app, so every screen is the
 * same as in the browser (and as the prototype). The app's own pages stay inside the window; WhatsApp,
 * e-mail and other websites open outside it. If the app cannot be reached, a "Not connected" page tries
 * again on its own.
 */
import path from 'node:path';
import { app, BrowserWindow, Menu, session, shell, type WebContents } from 'electron';
import { BRAND } from '../../../packages/shared/src/brand';
import { appUrl, linkAction } from './links';
import { startUpdates } from './updates';

const ORIGIN = appUrl(process.env);
const START = ORIGIN + '/';
const OFFLINE_PAGE = path.join(__dirname, 'static', 'offline.html');

// The app's own folder (sign-in, settings). Fixed, so renaming the app (brand.ts) never loses it.
// BILLING_PROFILE_DIR: a separate folder for tests.
app.setName(BRAND.name);
app.setPath('userData', process.env.BILLING_PROFILE_DIR || path.join(app.getPath('appData'), 'billing-erp-desktop'));

/** Permissions a page may have: copying to the clipboard and full screen, and only for the app's own pages. */
const ALLOWED = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);
const ownPage = (url: string | undefined) => !!url && linkAction(url, ORIGIN) === 'app';

const SAFE_PAGE = { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } as const;

/** Links, new windows and page changes: the app's pages stay inside, the rest opens outside or is refused. */
function guard(wc: WebContents) {
  wc.setWindowOpenHandler(({ url }) => {
    const a = linkAction(url, ORIGIN);
    if (a === 'app' || a === 'popup') {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: SAFE_PAGE } };
    }
    if (a === 'external') void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    const a = linkAction(url, ORIGIN);
    if (a === 'app') return;
    e.preventDefault();
    if (a === 'external') void shell.openExternal(url);
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.on('did-create-window', (child) => guard(child.webContents));
}

/** The app could not be reached: show the "Not connected" page, which tries again on its own. */
function showOffline(win: BrowserWindow) {
  void win.loadFile(OFFLINE_PAGE, { query: { to: START } });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: BRAND.name,
    autoHideMenuBar: true,
    // tests set the window to 1920 × 1080 for the picture checks, also on a smaller screen (Mac only)
    enableLargerThanScreen: !!process.env.BILLING_TEST,
    webPreferences: SAFE_PAGE,
  });
  guard(win.webContents);

  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    // -3: the page was replaced by another one before it finished (not an error)
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return;
    showOffline(win);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit') win.reload();
  });
  // F5 / Ctrl+R: load the page again (there is no menu bar to do it from)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const reload = input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r');
    if (reload) {
      e.preventDefault();
      if (win.webContents.getURL().startsWith('file:')) void win.loadURL(START);
      else win.reload();
    }
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });

  win.once('ready-to-show', () => {
    if (!process.env.BILLING_TEST) win.maximize();
    win.show();
  });
  void win.loadURL(START);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  // the app is already open: bring that window forward instead of opening a second copy
  app.quit();
} else {
  let main: BrowserWindow | null = null;
  app.on('second-instance', () => {
    if (!main) return;
    if (main.isMinimized()) main.restore();
    main.focus();
  });

  void app.whenReady().then(() => {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, done, details) => done(ALLOWED.has(permission) && ownPage(details.requestingUrl ?? wc.getURL())));
    ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED.has(permission) && ownPage(origin));

    // Windows: no menu bar (copy, paste and undo still work from the keyboard). Mac needs a basic menu for them.
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);

    main = createWindow();
    main.on('closed', () => (main = null));
    startUpdates(() => main);
  });

  app.on('window-all-closed', () => app.quit());
}
