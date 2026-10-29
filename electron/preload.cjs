const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('marketApp', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('market:get-app-info'),
  getDatabaseStatus: () => ipcRenderer.invoke('market:get-database-status')
}));
