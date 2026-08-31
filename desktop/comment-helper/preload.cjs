const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voicecap', {
  getStatus: () => ipcRenderer.invoke('helper:get-status'),
  restart: () => ipcRenderer.invoke('helper:restart'),
  openWebApp: () => ipcRenderer.invoke('helper:open-webapp'),
  openLogs: () => ipcRenderer.invoke('helper:open-logs'),
  setAutoStart: (enabled) => ipcRenderer.invoke('helper:set-auto-start', Boolean(enabled)),
  getPrinters: () => ipcRenderer.invoke('helper:get-printers'),
  savePrintSettings: (settings) => ipcRenderer.invoke('helper:save-print-settings', settings),
  testPrint: () => ipcRenderer.invoke('helper:test-print'),
  hideWindow: () => ipcRenderer.invoke('helper:hide-window'),
  quit: () => ipcRenderer.invoke('helper:quit'),
  onStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('helper:status', handler);
    return () => ipcRenderer.removeListener('helper:status', handler);
  }
});
