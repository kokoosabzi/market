const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openDatabase } = require('./database.cjs');

if (process.env.MARKET_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.MARKET_USER_DATA_DIR));

let mainWindow;
let database;

function requireText(value, label, maxLength = 200) {
  if (typeof value !== 'string') throw new Error(label + ' معتبر نیست.');
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(label + ' الزامی است و طول آن باید کمتر از ' + maxLength + ' نویسه باشد.');
  return normalized;
}
function requireId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('شناسه معتبر نیست.');
  return id;
}
function requireMoney(value, label, optional = false) {
  if ((value === '' || value === null || value === undefined) && optional) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(label + ' باید عدد صحیح نامنفی به ریال باشد.');
  return n;
}
function registerIpcHandlers() {
  ipcMain.handle('market:get-app-info', () => ({ name: 'Market', version: app.getVersion(), platform: process.platform }));
  ipcMain.handle('market:get-database-status', () => ({
    connected: Boolean(database && database.open),
    schemaVersion: database ? database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version : 0,
    location: path.join(app.getPath('userData'), 'data', 'market.sqlite')
  }));
  ipcMain.handle('market:get-settings', () => Object.fromEntries(
    database.prepare('SELECT setting_key, setting_value FROM app_settings').all().map(row => [row.setting_key, row.setting_value])
  ));
  ipcMain.handle('market:set-setting', (_event, payload = {}) => {
    const key = requireText(payload.key, 'کلید تنظیمات', 80);
    const value = requireText(payload.value, 'مقدار تنظیمات', 80);
    if (!['theme', 'money_display'].includes(key)) throw new Error('این تنظیم قابل تغییر نیست.');
    if (key === 'theme' && !['light', 'dark', 'system'].includes(value)) throw new Error('پوسته انتخاب‌شده معتبر نیست.');
    if (key === 'money_display' && !['irr', 'irt'].includes(value)) throw new Error('واحد نمایش معتبر نیست.');
    database.prepare(`INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run(key, value);
    return { key, value };
  });

  ipcMain.handle('catalog:list-categories', (_event, payload = {}) => {
    const includeInactive = payload.includeInactive === true;
    return database.prepare('SELECT id, name, is_active AS isActive FROM categories ' +
      (includeInactive ? '' : 'WHERE is_active = 1 ') + 'ORDER BY name COLLATE NOCASE').all();
  });
  ipcMain.handle('catalog:save-category', (_event, payload = {}) => {
    const name = requireText(payload.name, 'نام دسته‌بندی', 80);
    const id = payload.id ? requireId(payload.id) : null;
    if (id) {
      database.prepare("UPDATE categories SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(name, id);
      return database.prepare('SELECT id, name, is_active AS isActive FROM categories WHERE id = ?').get(id);
    }
    const result = database.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    return database.prepare('SELECT id, name, is_active AS isActive FROM categories WHERE id = ?').get(result.lastInsertRowid);
  });
  ipcMain.handle('catalog:list-products', (_event, payload = {}) => {
    const search = typeof payload.search === 'string' ? payload.search.trim().slice(0, 100) : '';
    const activeOnly = payload.activeOnly !== false;
    const rows = database.prepare(`SELECT p.id, p.code, p.name, p.category_id AS categoryId,
      c.name AS categoryName, p.unit, p.purchase_price_irr AS purchasePriceIrr,
      p.sale_price_irr AS salePriceIrr, p.min_stock_milli AS minStockMilli,
      p.description, p.is_active AS isActive
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE (? = '' OR p.code LIKE ? OR p.name LIKE ? OR COALESCE(c.name, '') LIKE ?)
      AND (? = 0 OR p.is_active = 1)
      ORDER BY p.is_active DESC, p.name COLLATE NOCASE LIMIT 500`).all(search, '%' + search + '%', '%' + search + '%', '%' + search + '%', activeOnly ? 1 : 0);
    return rows;
  });
  ipcMain.handle('catalog:save-product', (_event, payload = {}) => {
    const code = requireText(payload.code, 'کد کالا', 40).toUpperCase();
    const name = requireText(payload.name, 'نام کالا', 160);
    const unit = requireText(payload.unit || 'عدد', 'واحد کالا', 20);
    if (!['عدد', 'کیلوگرم', 'گرم', 'متر', 'لیتر', 'بسته', 'سرویس'].includes(unit)) throw new Error('واحد کالا معتبر نیست.');
    const categoryId = payload.categoryId === '' || payload.categoryId === null || payload.categoryId === undefined ? null : requireId(payload.categoryId);
    const purchasePrice = requireMoney(payload.purchasePriceIrr, 'قیمت خرید', true);
    const salePrice = requireMoney(payload.salePriceIrr ?? 0, 'قیمت فروش');
    const minStock = Number(payload.minStockMilli ?? 0);
    if (!Number.isSafeInteger(minStock) || minStock < 0) throw new Error('حداقل موجودی معتبر نیست.');
    const description = typeof payload.description === 'string' ? payload.description.trim().slice(0, 1000) : '';
    const id = payload.id ? requireId(payload.id) : null;
    if (categoryId && !database.prepare('SELECT 1 FROM categories WHERE id = ? AND is_active = 1').get(categoryId)) throw new Error('دسته‌بندی انتخاب‌شده فعال نیست.');
    if (id) {
      database.prepare(`UPDATE products SET code=?, name=?, category_id=?, unit=?, purchase_price_irr=?, sale_price_irr=?,
        min_stock_milli=?, description=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?`)
        .run(code, name, categoryId, unit, purchasePrice, salePrice, minStock, description, id);
      return database.prepare('SELECT id, code, name FROM products WHERE id = ?').get(id);
    }
    const result = database.prepare(`INSERT INTO products (code,name,category_id,unit,purchase_price_irr,sale_price_irr,min_stock_milli,description)
      VALUES (?,?,?,?,?,?,?,?)`).run(code, name, categoryId, unit, purchasePrice, salePrice, minStock, description);
    return database.prepare('SELECT id, code, name FROM products WHERE id = ?').get(result.lastInsertRowid);
  });
  ipcMain.handle('catalog:set-product-active', (_event, payload = {}) => {
    const id = requireId(payload.id);
    const active = payload.active === true ? 1 : 0;
    database.prepare("UPDATE products SET is_active=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?").run(active, id);
    return { id, active: Boolean(active) };
  });
}
function runSmokeCheck() {
  if (!process.argv.includes('--smoke-test')) return;
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const result = await mainWindow.webContents.executeJavaScript('window.marketApp.getDatabaseStatus()');
      if (!result?.connected || result.schemaVersion < 1) throw new Error('Renderer IPC or SQLite migration check failed');
      console.log(`ELECTRON_SMOKE_OK schema=${result.schemaVersion}`);
      if (database?.open) database.close();
      database = null;
      app.exit(0);
    } catch (error) {
      console.error('ELECTRON_SMOKE_FAILED:', error);
      if (database?.open) database.close();
      database = null;
      app.exit(1);
    }
  });
}
function createWindow() {
  const entryPath = path.resolve(__dirname, '../src/index.html');
  const allowedUrl = pathToFileURL(entryPath).href;
  mainWindow = new BrowserWindow({
    width: 1280, height: 850, minWidth: 980, minHeight: 680,
    title: 'Market | نرم‌افزار فروشگاهی', backgroundColor: '#f4f6fb',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => { if (targetUrl !== allowedUrl) event.preventDefault(); });
  runSmokeCheck();
  mainWindow.loadFile(entryPath);
  mainWindow.on('closed', () => { mainWindow = null; });
}
app.whenReady().then(() => {
  const dataDirectory = path.join(app.getPath('userData'), 'data');
  database = openDatabase(path.join(dataDirectory, 'market.sqlite'), path.join(__dirname, 'migrations'));
  registerIpcHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => { console.error('Market startup failed:', error); app.exit(1); });
app.on('before-quit', () => { if (database && database.open) database.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
