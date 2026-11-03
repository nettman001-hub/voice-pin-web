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
  setSttDevice: (device) => ipcRenderer.invoke('helper:set-stt-device', device),
  detectSttDevices: () => ipcRenderer.invoke('helper:detect-stt-devices'),
  hideWindow: () => ipcRenderer.invoke('helper:hide-window'),
  // 안드로이드 댓글 연결: 인증·연결 전용 메서드만 연다(임의 HTTP·파일 접근 없음).
  androidGet: () => ipcRenderer.invoke('android:get'),
  androidRegister: () => ipcRenderer.invoke('android:register'),
  androidCancelRegister: () => ipcRenderer.invoke('android:cancel-register'),
  androidSetEnabled: (enabled) => ipcRenderer.invoke('android:set-enabled', enabled === true),
  androidIssueCode: () => ipcRenderer.invoke('android:issue-code'),
  androidCancelCode: () => ipcRenderer.invoke('android:cancel-code'),
  androidDecide: (linkId, approve) => ipcRenderer.invoke('android:decide', String(linkId || ''), approve === true),
  androidUnlink: (linkId) => ipcRenderer.invoke('android:unlink', String(linkId || '')),
  androidUnregister: () => ipcRenderer.invoke('android:unregister'),
  quit: () => ipcRenderer.invoke('helper:quit'),
  onStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('helper:status', handler);
    return () => ipcRenderer.removeListener('helper:status', handler);
  }
});
