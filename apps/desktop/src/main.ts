/**
 * The Windows app. One window with two parts:
 *   - the title bar (static/titlebar.html): the page's title, the app's version and the
 *     "Check for updates" button (owner, 10 Nov 2026), next to Windows' own minimise / maximise / close;
 *   - below it, the web app itself, so every screen is the same as in the browser (and as the prototype).
 * The app's own pages stay inside the window; WhatsApp, e-mail and other websites open outside it. If the
 * app cannot be reached, a "Not connected" page tries again on its own.
 */
import path from 'node:path';
import { app, BaseWindow, ipcMain, Menu, nativeTheme, session, shell, WebContentsView, type WebContents } from 'electron';
import { BRAND } from '../../../packages/shared/src/brand';
import { appUrl, linkAction } from './links';
import { startPrinting } from './printing';
import { startUpdates, type Updates } from './updates';

const ORIGIN = appUrl(process.env);
const START = ORIGIN + '/';
const OFFLINE_PAGE = path.join(__dirname, 'static', 'offline.html');
const TITLEBAR_PAGE = path.join(__dirname, 'static', 'titlebar.html');
/** height of the title bar, in px */
const BAR = 36;

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

/** Windows' minimise / maximise / close buttons, in the title bar's colours (light or dark like Windows). */
const overlay = () => (nativeTheme.shouldUseDarkColors ? { color: '#0e1120', symbolColor: '#e9ebf4', height: BAR } : { color: '#f4f5fa', symbolColor: '#151b2e', height: BAR });

interface Main { win: BaseWindow; page: WebContents; bar: WebContents }

function createWindow(updates: Updates): Main {
  const win = new BaseWindow({
    width: 1366,
    height: 768 + BAR,
    minWidth: 1000,
    minHeight: 600 + BAR,
    show: false,
    backgroundColor: '#f4f5fa',
    title: BRAND.name,
    autoHideMenuBar: true,
    // our own title bar (titlebar.html), with the system's window buttons kept
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 11 } } : { titleBarOverlay: overlay() }),
    // tests set the window to 1920 × 1080 for the picture checks, also on a smaller screen (Mac only)
    enableLargerThanScreen: !!process.env.BILLING_TEST,
  });

  const barView = new WebContentsView({ webPreferences: { ...SAFE_PAGE, preload: path.join(__dirname, 'preload-titlebar.cjs') } });
  // the app's pages get window.billingDesktop (printing), only on the app's own address (preload.ts)
  const pageView = new WebContentsView({ webPreferences: { ...SAFE_PAGE, preload: path.join(__dirname, 'preload.cjs'), additionalArguments: [`--billing-origin=${ORIGIN}`] } });
  win.contentView.addChildView(pageView);
  win.contentView.addChildView(barView);
  const bar = barView.webContents;
  const page = pageView.webContents;

  const layout = () => {
    const { width, height } = win.getContentBounds();
    barView.setBounds({ x: 0, y: 0, width, height: BAR });
    pageView.setBounds({ x: 0, y: BAR, width, height: Math.max(0, height - BAR) });
  };
  layout();
  win.on('resize', layout);
  nativeTheme.on('updated', () => { if (process.platform !== 'darwin' && !win.isDestroyed()) win.setTitleBarOverlay(overlay()); });

  // the title bar: no links, no other pages, nothing opened from it
  bar.setWindowOpenHandler(() => ({ action: 'deny' }));
  bar.on('will-navigate', (e) => e.preventDefault());
  void bar.loadFile(TITLEBAR_PAGE, { query: { os: process.platform, letter: BRAND.name.charAt(0).toUpperCase() } });

  guard(page);
  const showOffline = () => void page.loadFile(OFFLINE_PAGE, { query: { to: START } });
  page.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    // -3: the page was replaced by another one before it finished (not an error)
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return;
    showOffline();
  });
  page.on('render-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit') page.reload();
  });
  page.on('page-title-updated', (_e, title) => {
    win.setTitle(title);
    if (!bar.isDestroyed()) bar.send('titlebar:changed', { title });
  });
  // F5 / Ctrl+R: load the page again (there is no menu bar to do it from)
  page.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const reload = input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r');
    if (reload) {
      e.preventDefault();
      if (page.getURL().startsWith('file:')) void page.loadURL(START);
      else page.reload();
    }
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') page.toggleDevTools();
  });
  win.on('focus', () => page.focus());

  updates.onChange(() => { if (!bar.isDestroyed()) bar.send('titlebar:changed', updates.view()); });

  if (!process.env.BILLING_TEST) win.maximize();
  win.show();
  void page.loadURL(START);
  page.focus();
  return { win, page, bar };
}

if (!app.requestSingleInstanceLock()) {
  // the app is already open: bring that window forward instead of opening a second copy
  app.quit();
} else {
  let main: Main | null = null;
  app.on('second-instance', () => {
    if (!main) return;
    if (main.win.isMinimized()) main.win.restore();
    main.win.focus();
  });

  void app.whenReady().then(() => {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, done, details) => done(ALLOWED.has(permission) && ownPage(details.requestingUrl ?? wc.getURL())));
    ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED.has(permission) && ownPage(origin));

    // Windows: no menu bar (copy, paste and undo still work from the keyboard). Mac needs a basic menu for them.
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);

    startPrinting(ownPage);
    const updates = startUpdates();
    // only the title bar's page may ask about updates
    const fromBar = (wc: WebContents) => { if (!main || wc !== main.bar) throw new Error('Not allowed'); };
    ipcMain.handle('titlebar:get', (e) => { fromBar(e.sender); return { ...updates.view(), title: main!.page.getTitle() || BRAND.name }; });
    ipcMain.handle('titlebar:check', (e) => { fromBar(e.sender); updates.check(); });
    ipcMain.handle('titlebar:install', (e) => { fromBar(e.sender); updates.install(); });

    main = createWindow(updates);
    main.win.on('closed', () => (main = null));
  });

  app.on('window-all-closed', () => app.quit());
}
