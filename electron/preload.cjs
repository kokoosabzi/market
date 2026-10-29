const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marketApp', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('market:get-app-info'),
  getDatabaseStatus: () => ipcRenderer.invoke('market:get-database-status'),
  getSettings: () => ipcRenderer.invoke('market:get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('market:set-setting', { key, value }),
  listCategories: (includeInactive = false) => ipcRenderer.invoke('catalog:list-categories', { includeInactive }),
  saveCategory: (category) => ipcRenderer.invoke('catalog:save-category', category),
  listProducts: (filters = {}) => ipcRenderer.invoke('catalog:list-products', filters),
  saveProduct: (product) => ipcRenderer.invoke('catalog:save-product', product),
  setProductActive: (id, active) => ipcRenderer.invoke('catalog:set-product-active', { id, active })
}));
