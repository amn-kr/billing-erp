/** The title bar's page (static/titlebar.html): the window's title, the version and the update button. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('titlebar', {
  get: () => ipcRenderer.invoke('titlebar:get'),
  check: () => ipcRenderer.invoke('titlebar:check'),
  install: () => ipcRenderer.invoke('titlebar:install'),
  onChange: (fn: (v: unknown) => void) => { ipcRenderer.on('titlebar:changed', (_e, v) => fn(v)); },
});
