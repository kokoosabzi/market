const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openDatabase } = require('./database.cjs');

let mainWindow;
let database;

function registerIpcHandlers() {
  ipcMain.handle('market:get-app-info', () => ({
    name: 'Market', version: app.getVersion(), platform: process.platform
  }));
  ipcMain.handle('market:get-database-status', () => ({
    connected: Boolean(database && database.open),
    schemaVersion: database
      ? database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version
      : 0,
    location: path.join(app.getPath('userData'), 'data', 'market.sqlite')
  }));
}

function createWindow() {
  const entryPath = path.resolve(__dirname, '../src/index.html');
  const allowedUrl = pathToFileURL(entryPath).href;
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600,
    title: 'Market | نرم‌افزار فروشگاهی', backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== allowedUrl) event.preventDefault();
  });
  mainWindow.loadFile(entryPath);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const dataDirectory = path.join(app.getPath('userData'), 'data');
  database = openDatabase(path.join(dataDirectory, 'market.sqlite'), path.join(__dirname, 'migrations'));
  registerIpcHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error('Market startup failed:', error);
  app.quit();
});

app.on('before-quit', () => { if (database && database.open) database.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
