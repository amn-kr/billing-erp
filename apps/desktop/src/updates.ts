/**
 * Auto-update (installed app only). The app looks for a newer version on the project's GitHub
 * Releases when it starts and every 4 hours, downloads it in the background, then asks:
 * "Restart now" or "Later" (Later installs it the next time the app is closed). No internet: it
 * simply tries again next time.
 */
import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';
import { autoUpdater } from 'electron-updater';

const EVERY = 4 * 60 * 60 * 1000;

export function startUpdates(window: () => BrowserWindow | null): void {
  // not while developing or testing (BILLING_NO_UPDATES: the installed app's own smoke test)
  if (!app.isPackaged || process.env.BILLING_NO_UPDATES) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // no internet, GitHub busy, …: nothing to tell the shop; the next check tries again
  autoUpdater.on('error', () => {});

  let asked = false;
  autoUpdater.on('update-downloaded', async (info) => {
    if (asked) return;
    asked = true;
    const opts: MessageBoxOptions = {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 1,
      cancelId: 1,
      title: 'Update ready',
      message: `A new version (${info.version}) is ready.`,
      detail: 'Save any bill you are typing, then restart to use it. If you choose Later, it is installed the next time you close the app.',
    };
    const win = window();
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (response === 0) autoUpdater.quitAndInstall();
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, EVERY);
}
