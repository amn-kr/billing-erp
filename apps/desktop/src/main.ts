/**
 * The Windows app. One window with two parts:
 *   - the title bar (static/titlebar.html): the page's title, the app's version and the
 *     "Check for updates" button (owner, 10 Nov 2026), next to Windows' own minimise / maximise / close;
 *   - below it, the web app itself, so every screen is the same as in the browser (and as the prototype).
 * The app's own pages stay inside the window; WhatsApp, e-mail and other websites open outside it. If the
 * app cannot be reached, a "Not connected" page tries again on its own.
 *
 * Two ways to run (docs/ARCHITECTURE.md, Phase 6): online (the live app) or single-PC (mode "local": the
 * shop's own database and server on this computer, local/run.ts). The first start asks which
 * (static/welcome.html) and keeps the answer in <userData>/mode.json (mode.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BaseWindow, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, WebContentsView, type WebContents } from 'electron';
import { BRAND } from '../../../packages/shared/src/brand';
import { appUrl, linkAction } from './links';
import { startLocal, type Local } from './local/run';
import { isMode, readMode, writeMode, type Mode } from './mode';
import { startPrinting } from './printing';
import { startUpdates, type Updates } from './updates';

/** The app's address: the live app, or http://127.0.0.1:<port> once single-PC mode's server is up. */
let ORIGIN = appUrl(process.env);
const start = () => ORIGIN + '/';
const OFFLINE_PAGE = path.join(__dirname, 'static', 'offline.html');
const STARTING_PAGE = path.join(__dirname, 'static', 'starting.html');
const TITLEBAR_PAGE = path.join(__dirname, 'static', 'titlebar.html');
const WELCOME_PAGE = path.join(__dirname, 'static', 'welcome.html');
const RECOVERY_PAGE = path.join(__dirname, 'static', 'recovery-key.html');
/** height of the title bar, in px */
const BAR = 36;
/** the app's version, from package.json (build.mjs) */
declare const __APP_VERSION__: string;
/** the app's Google sign-in client for Drive backups (build.mjs); tests use BILLING_GOOGLE_* */
declare const __GOOGLE__: { id: string; secret: string };

// The app's own folder (sign-in, settings). Fixed, so renaming the app (brand.ts) never loses it.
// BILLING_PROFILE_DIR: a separate folder for tests.
app.setName(BRAND.name);
app.setPath('userData', process.env.BILLING_PROFILE_DIR || path.join(app.getPath('appData'), 'billing-erp-desktop'));

/** single-PC mode is on (the shop's books on this computer), once chosen */
let LOCAL = false;

/** Where single-PC mode's parts are: next to the installed app (resources/), or in dist/ while developing. */
function localPaths() {
  const base = app.isPackaged ? process.resourcesPath : __dirname;
  return {
    root: path.join(app.getPath('userData'), 'local'),
    pgDir: process.env.BILLING_PG_DIR || path.join(base, 'postgres'),
    serverDir: path.join(base, 'server'),
    webDir: path.join(base, 'web'),
  };
}

/** Google Drive in single-PC mode: the client built into the app, or a pretend Google in tests */
function googleClient() {
  const e = process.env;
  if (e.BILLING_TEST && e.BILLING_GOOGLE_CLIENT_ID) {
    return { id: e.BILLING_GOOGLE_CLIENT_ID, secret: e.BILLING_GOOGLE_CLIENT_SECRET ?? '', url: e.BILLING_GOOGLE_URL ?? '' };
  }
  return { id: __GOOGLE__.id, secret: __GOOGLE__.secret, url: '' };
}

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
  const pageView = new WebContentsView({ webPreferences: { ...SAFE_PAGE, preload: path.join(__dirname, 'preload.cjs') } });
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
  const showOffline = () => void page.loadFile(OFFLINE_PAGE, { query: { to: start() } });
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
      if (page.getURL().includes('/static/offline.html')) void page.loadURL(start());
      else page.reload();
    }
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') page.toggleDevTools();
  });
  win.on('focus', () => page.focus());

  updates.onChange(() => { if (!bar.isDestroyed()) bar.send('titlebar:changed', updates.view()); });

  if (!process.env.BILLING_TEST) win.maximize();
  win.show();
  page.focus();
  return { win, page, bar };
}

/** The first start: "This PC only" or "Connect to cloud" (static/welcome.html). Resolves with the choice, once kept. */
function askMode(page: WebContents): Promise<Mode> {
  return new Promise((done) => {
    ipcMain.handle('welcome:choose', (e, m: unknown) => {
      // only the first-start page, in this window, may choose
      if (e.sender !== page || !e.sender.getURL().includes('/static/welcome.html') || !isMode(m)) throw new Error('Not allowed');
      writeMode(app.getPath('userData'), m);
      ipcMain.removeHandler('welcome:choose');
      done(m);
    });
    void page.loadFile(WELCOME_PAGE, { query: { brand: BRAND.name } });
  });
}

/**
 * Single-PC mode's backup buttons (Settings › Backup & restore, Windows app only): choose the backup
 * folder or pen drive, show and print the recovery key. Only for the app's own page in this window.
 */
function startBackupLinks(getMain: () => Main | null, getLocal: () => Local | null, onMovedToCloud: () => void) {
  const check = (wc: WebContents) => {
    const m = getMain();
    const l = getLocal();
    if (!m || wc !== m.page || !ownPage(wc.getURL()) || !l) throw new Error('Not allowed');
    return { m, l };
  };
  ipcMain.handle('backup:chooseFolder', async (e, title: unknown) => {
    const { m } = check(e.sender);
    const r = await dialog.showOpenDialog(m.win as unknown as BrowserWindow, {
      title: typeof title === 'string' ? title.slice(0, 100) : 'Choose the backup folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle('backup:recoveryKey', (e) => check(e.sender).l.recovery());
  // Move to cloud done (the books are in the online app): this computer works online from now on.
  // The books on this computer stay where they are (local/pgdata), no longer opened.
  ipcMain.handle('cloud:switch', async (e, moved: unknown) => {
    const { m, l } = check(e.sender);
    const mv = moved as { code?: unknown; email?: unknown } | null;
    if (typeof mv?.code !== 'string' || typeof mv.email !== 'string') throw new Error('Not allowed');
    writeMode(app.getPath('userData'), 'online', { code: mv.code.slice(0, 40), email: mv.email.slice(0, 200) });
    await l.stop();
    onMovedToCloud();
    void m.page.loadURL(start());
  });
  ipcMain.handle('backup:printKey', async (e) => {
    const { l } = check(e.sender);
    const { key } = await l.recovery();
    // a page of its own, never shown: the key printed on A4 with what to do with it
    const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    try {
      await w.loadFile(RECOVERY_PAGE, { query: { key, brand: BRAND.name } });
      // tests: saved as a PDF instead of the print window
      const pdf = process.env.BILLING_TEST ? process.env.BILLING_PRINT_KEY_TO : undefined;
      let ok: boolean;
      if (pdf) {
        fs.writeFileSync(pdf, await w.webContents.printToPDF({ pageSize: 'A4' }));
        ok = true;
      } else {
        ok = await new Promise<boolean>((done) => w.webContents.print({ silent: false, printBackground: true }, (success) => done(success)));
      }
      if (ok) await l.markPrinted();
      return { ok };
    } finally {
      w.destroy();
    }
  });
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
    // a sign-in is written to disk at once, not up to 30 s later, so a crash or power cut right after
    // signing in does not sign the shop out
    let flush: ReturnType<typeof setTimeout> | undefined;
    ses.cookies.on('changed', () => { clearTimeout(flush); flush = setTimeout(() => void ses.cookies.flushStore(), 200); });

    // Windows: no menu bar (copy, paste and undo still work from the keyboard). Mac needs a basic menu for them.
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);

    startPrinting(ownPage);
    const updates = startUpdates();
    // only the title bar's page may ask about updates
    const fromBar = (wc: WebContents) => { if (!main || wc !== main.bar) throw new Error('Not allowed'); };
    ipcMain.handle('titlebar:get', (e) => { fromBar(e.sender); return { ...updates.view(), title: main!.page.getTitle() || BRAND.name }; });
    ipcMain.handle('titlebar:check', (e) => { fromBar(e.sender); updates.check(); });
    ipcMain.handle('titlebar:install', (e) => { fromBar(e.sender); updates.install(); });

    // the page's address, for the printing link (preload.ts): only the app's own pages get printing
    ipcMain.on('billing:origin', (e) => { e.returnValue = { origin: ORIGIN, local: LOCAL }; });
    startBackupLinks(() => main, () => local, () => {
      // from now on: the online app, as if "Connect to cloud" had been chosen
      local = null;
      LOCAL = false;
      ORIGIN = appUrl(process.env);
    });

    main = createWindow(updates);
    const { page } = main;
    main.win.on('closed', () => (main = null));

    void (async () => {
      const chosen = readMode(app.getPath('userData')) ?? (await askMode(page));
      if (chosen === 'online') return void page.loadURL(start());
      // single-PC mode: "Opening your books…" until this computer's database and server are up; if they fail, why
      LOCAL = true;
      const paths = localPaths();
      void page.loadFile(STARTING_PAGE);
      try {
        const l = await startLocal(paths, __APP_VERSION__, googleClient(), appUrl(process.env));
        local = l;
        ORIGIN = l.origin;
        if (!page.isDestroyed()) void page.loadURL(start());
      } catch (e) {
        if (!page.isDestroyed()) void page.loadFile(STARTING_PAGE, { query: { error: e instanceof Error ? e.message : String(e), log: path.join(paths.root, 'server.log') } });
      }
    })();
  });

  // single-PC mode: closing the app (or restarting for an update) stops the server and the database first
  let local: Local | null = null;
  let stopped = false;
  app.on('before-quit', (e) => {
    if (!local || stopped) return;
    e.preventDefault();
    const l = local;
    local = null;
    void l.stop().finally(() => { stopped = true; app.quit(); });
  });

  app.on('window-all-closed', () => app.quit());
}
