const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupApi', {
  saveConfig: (config) => ipcRenderer.invoke('setup:save-config', config),
  loadCurrentConfig: () => ipcRenderer.invoke('setup:load-config'),
  getConfigPath: () => ipcRenderer.invoke('setup:get-config-path')
});
