/**
 * What the Windows app adds to the app's pages: `window.billingDesktop`, for direct printing.
 * Only on the app's own address (the main process checks every request again).
 */
import { contextBridge, ipcRenderer } from 'electron';

// the app's address (the live app, or this computer's own server in single-PC mode), from the main process
const origin = ipcRenderer.sendSync('billing:origin') as string | undefined;

if (origin && location.origin === origin) {
  contextBridge.exposeInMainWorld('billingDesktop', {
    printers: () => ipcRenderer.invoke('printing:list'),
    choosePrinter: (name: string | null) => ipcRenderer.invoke('printing:choose', name),
    print: (page?: string) => ipcRenderer.invoke('printing:print', page),
  });
}
