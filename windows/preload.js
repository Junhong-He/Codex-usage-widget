const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getUsage: () => ipcRenderer.invoke('get-usage'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  configDir: () => ipcRenderer.invoke('config-dir'),
  moveWindow: (dx, dy) => ipcRenderer.invoke('move-window', dx, dy),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', width, height),
});
