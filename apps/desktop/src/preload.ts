/**
 * What the Windows app adds to the app's pages: `window.billingDesktop`, for direct printing.
 * Only on the app's own address (the main process checks every request again).
 */
import { contextBridge, ipcRenderer } from 'electron';

const origin = process.argv.find((a) => a.startsWith('--billing-origin='))?.slice('--billing-origin='.length);

if (origin && location.origin === origin) {
  contextBridge.exposeInMainWorld('billingDesktop', {
    printers: () => ipcRenderer.invoke('printing:list'),
    choosePrinter: (name: string | null) => ipcRenderer.invoke('printing:choose', name),
    print: (page?: string) => ipcRenderer.invoke('printing:print', page),
  });
}
