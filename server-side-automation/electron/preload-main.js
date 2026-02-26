const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApi', {
  showSetup: () => ipcRenderer.invoke('main:show-setup')
});
