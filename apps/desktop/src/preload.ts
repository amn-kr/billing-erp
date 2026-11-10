/**
 * What the Windows app adds to its pages:
 *   - the app's own pages: `window.billingDesktop`, for direct printing, and whether the books are on
 *     this computer (single-PC mode);
 *   - the first-start page (static/welcome.html): `window.billingWelcome`, to choose single-PC or cloud.
 * Each only on its own page (the main process checks every request again).
 */
import { contextBridge, ipcRenderer } from 'electron';

// the app's address (the live app, or this computer's own server in single-PC mode), from the main process
const { origin, local } = (ipcRenderer.sendSync('billing:origin') ?? {}) as { origin?: string; local?: boolean };

if (origin && location.origin === origin) {
  contextBridge.exposeInMainWorld('billingDesktop', {
    local: !!local,
    printers: () => ipcRenderer.invoke('printing:list'),
    choosePrinter: (name: string | null) => ipcRenderer.invoke('printing:choose', name),
    print: (page?: string) => ipcRenderer.invoke('printing:print', page),
  });
} else if (location.protocol === 'file:' && location.pathname.endsWith('/static/welcome.html')) {
  contextBridge.exposeInMainWorld('billingWelcome', {
    choose: (mode: 'local' | 'online') => ipcRenderer.invoke('welcome:choose', mode),
  });
}
