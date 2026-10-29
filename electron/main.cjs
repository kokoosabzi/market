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

  function roundRatio(numerator, denominator) {
    const n = BigInt(numerator), d = BigInt(denominator);
    return Number((n + d / 2n) / d);
  }
  function prepareDocumentItems(type, items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 200) throw new Error('سند باید حداقل یک قلم و حداکثر ۲۰۰ قلم داشته باشد.');
    return items.map((item, index) => {
      const productId = requireId(item.productId);
      const product = database.prepare('SELECT id, unit, purchase_price_irr, sale_price_irr, is_active FROM products WHERE id=?').get(productId);
      if (!product || !product.is_active) throw new Error('کالای ردیف ' + (index + 1) + ' وجود ندارد یا غیرفعال است.');
      const quantityMilli = Number(item.quantityMilli);
      if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) throw new Error('مقدار ردیف ' + (index + 1) + ' باید مثبت باشد.');
      if (['عدد', 'بسته', 'سرویس'].includes(product.unit) && quantityMilli % 1000 !== 0) throw new Error('برای کالای شمارشی، مقدار کسری مجاز نیست (ردیف ' + (index + 1) + ').');
      const unitPrice = requireMoney(item.unitPriceIrr, 'قیمت واحد ردیف ' + (index + 1));
      const gross = roundRatio(BigInt(unitPrice) * BigInt(quantityMilli), 1000);
      const discountType = item.discountType || 'none';
      const discountValue = Number(item.discountValue || 0);
      if (!['none', 'fixed', 'percent'].includes(discountType) || !Number.isSafeInteger(discountValue) || discountValue < 0) throw new Error('تخفیف ردیف ' + (index + 1) + ' معتبر نیست.');
      if (discountType === 'percent' && discountValue > 100) throw new Error('درصد تخفیف باید بین صفر تا صد باشد.');
      const discount = discountType === 'none' ? 0 : discountType === 'fixed' ? Math.min(gross, discountValue) : roundRatio(BigInt(gross) * BigInt(discountValue), 100);
      const taxRate = Number(item.taxRateBp || 0);
      if (!Number.isSafeInteger(taxRate) || taxRate < 0 || taxRate > 10000) throw new Error('نرخ مالیات معتبر نیست.');
      const tax = roundRatio(BigInt(gross - discount) * BigInt(taxRate), 10000);
      return { product, productId, quantityMilli, unitPrice, discountType, discountValue, gross, discount, taxRate, tax, total: gross - discount + tax };
    });
  }
  function documentTotals(items) {
    return items.reduce((sum, item) => ({
      subtotal: sum.subtotal + item.gross,
      discount: sum.discount + item.discount,
      tax: sum.tax + item.tax,
      total: sum.total + item.total
    }), { subtotal: 0, discount: 0, tax: 0, total: 0 });
  }
  ipcMain.handle('documents:list', (_event, payload = {}) => {
    const type = payload.type;
    if (!['purchase', 'sale'].includes(type)) throw new Error('نوع سند معتبر نیست.');
    return database.prepare(`SELECT d.id, d.document_number AS documentNumber, d.document_date AS documentDate,
      d.status, d.party_name AS partyName, d.total_irr AS totalIrr,
      (SELECT COUNT(*) FROM document_items i WHERE i.document_id=d.id) AS itemCount
      FROM documents d WHERE d.document_type=? ORDER BY d.id DESC LIMIT 200`).all(type);
  });
  ipcMain.handle('documents:get', (_event, payload = {}) => {
    const id = requireId(payload.id);
    const doc = database.prepare(`SELECT id, document_type AS type, document_number AS documentNumber,
      document_date AS documentDate, status, party_name AS partyName, notes, subtotal_irr AS subtotalIrr,
      discount_irr AS discountIrr, tax_irr AS taxIrr, total_irr AS totalIrr, void_reason AS voidReason
      FROM documents WHERE id=?`).get(id);
    if (!doc) throw new Error('سند پیدا نشد.');
    doc.items = database.prepare(`SELECT i.id, i.product_id AS productId, p.code AS productCode, p.name AS productName,
      p.unit, i.quantity_milli AS quantityMilli, i.unit_price_irr AS unitPriceIrr,
      i.gross_irr AS grossIrr, i.discount_irr AS discountIrr, i.tax_irr AS taxIrr,
      i.total_irr AS totalIrr, i.unit_cost_snapshot_irr AS unitCostSnapshotIrr, i.cost_status AS costStatus
      FROM document_items i JOIN products p ON p.id=i.product_id WHERE i.document_id=? ORDER BY i.id`).all(id);
    return doc;
  });
  ipcMain.handle('documents:save-draft', (_event, payload = {}) => {
    const type = payload.type;
    if (!['purchase', 'sale'].includes(type)) throw new Error('نوع سند معتبر نیست.');
    const date = requireText(payload.documentDate, 'تاریخ سند', 10);
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw new Error('تاریخ سند معتبر نیست.');
    const partyName = typeof payload.partyName === 'string' ? payload.partyName.trim().slice(0, 160) : '';
    const notes = typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 1000) : '';
    const items = prepareDocumentItems(type, payload.items);
    const totals = documentTotals(items);
    const existingId = payload.id ? requireId(payload.id) : null;
    return database.transaction(() => {
      let id;
      if (existingId) {
        const existing = database.prepare('SELECT status, document_type FROM documents WHERE id=?').get(existingId);
        if (!existing || existing.status !== 'draft' || existing.document_type !== type) throw new Error('فقط پیش‌نویس همین نوع سند قابل ویرایش است.');
        id = existingId;
        database.prepare(`UPDATE documents SET document_date=?, party_name=?, notes=?, subtotal_irr=?, discount_irr=?, tax_irr=?, total_irr=?,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?`).run(date, partyName, notes, totals.subtotal, totals.discount, totals.tax, totals.total, id);
        database.prepare('DELETE FROM document_items WHERE document_id=?').run(id);
      } else {
        const temp = 'TEMP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
        const result = database.prepare(`INSERT INTO documents(document_type,document_number,document_date,party_name,notes,subtotal_irr,discount_irr,tax_irr,total_irr)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(type, temp, date, partyName, notes, totals.subtotal, totals.discount, totals.tax, totals.total);
        id = result.lastInsertRowid;
        database.prepare('UPDATE documents SET document_number=? WHERE id=?').run('DRAFT-' + id, id);
      }
      const insert = database.prepare(`INSERT INTO document_items(document_id,product_id,quantity_milli,unit_price_irr,discount_type,discount_value,tax_rate_bp,gross_irr,discount_irr,tax_irr,total_irr)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of items) insert.run(id, item.productId, item.quantityMilli, item.unitPrice, item.discountType, item.discountValue, item.taxRate, item.gross, item.discount, item.tax, item.total);
      return { id, status: 'draft', ...totals };
    })();
  });
  ipcMain.handle('documents:finalize', (_event, payload = {}) => {
    const id = requireId(payload.id);
    return database.transaction(() => {
      const doc = database.prepare('SELECT * FROM documents WHERE id=?').get(id);
      if (!doc || doc.status !== 'draft') throw new Error('فقط پیش‌نویس قابل نهایی‌سازی است.');
      const items = database.prepare(`SELECT i.*, p.unit, p.purchase_price_irr, p.sale_price_irr
        FROM document_items i JOIN products p ON p.id=i.product_id WHERE i.document_id=? ORDER BY i.id`).all(id);
      if (!items.length) throw new Error('سند بدون قلم قابل نهایی‌سازی نیست.');
      const prefix = doc.document_type === 'purchase' ? 'BUY' : 'SAL';
      const number = prefix + '-' + String(id).padStart(8, '0');
      if (database.prepare('SELECT 1 FROM documents WHERE document_number=? AND id<>?').get(number, id)) throw new Error('شمارهٔ سند تکراری است.');
      database.prepare('UPDATE documents SET document_number=? WHERE id=?').run(number, id);
      const addMovement = database.prepare('INSERT INTO inventory_movements(product_id,document_id,document_item_id,quantity_delta_milli,event_type) VALUES(?,?,?,?,?)');
      const updateCost = database.prepare('UPDATE document_items SET unit_cost_snapshot_irr=?, cost_status=? WHERE id=?');
      for (const item of items) {
        if (doc.document_type === 'purchase') {
          addMovement.run(item.product_id, id, item.id, item.quantity_milli, 'purchase');
          database.prepare("UPDATE products SET purchase_price_irr=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?").run(item.unit_price_irr, item.product_id);
        } else {
          const currentStock = database.prepare('SELECT COALESCE(SUM(quantity_delta_milli),0) AS qty FROM inventory_movements WHERE product_id=?').get(item.product_id).qty;
          const latestCost = database.prepare(`SELECT i.unit_price_irr AS price FROM document_items i
            JOIN documents d ON d.id=i.document_id
            WHERE d.document_type='purchase' AND d.status='finalized' AND i.product_id=?
            ORDER BY d.finalized_at DESC, d.id DESC, i.id DESC LIMIT 1`).get(item.product_id);
          const cost = latestCost ? latestCost.price : null;
          const costStatus = cost === null ? 'unknown' : currentStock < item.quantity_milli ? 'estimated' : 'known';
          updateCost.run(cost, costStatus, item.id);
          addMovement.run(item.product_id, id, item.id, -item.quantity_milli, 'sale');
        }
      }
      database.prepare("UPDATE documents SET status='finalized', finalized_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?").run(id);
      return { id, documentNumber: number, status: 'finalized' };
    })();
  });
  ipcMain.handle('documents:void', (_event, payload = {}) => {
    const id = requireId(payload.id);
    const reason = requireText(payload.reason, 'علت ابطال', 500);
    return database.transaction(() => {
      const doc = database.prepare('SELECT * FROM documents WHERE id=?').get(id);
      if (!doc || doc.status !== 'finalized') throw new Error('فقط سند نهایی قابل ابطال است.');
      const dependent = database.prepare("SELECT 1 FROM documents WHERE status='finalized' AND id<>? AND id>? LIMIT 1").get(id, id);
      if (dependent) throw new Error('برای ایمنی، ابطال سند دارای اسناد نهایی بعدی از این مسیر مجاز نیست.');
      const items = database.prepare('SELECT * FROM document_items WHERE document_id=?').all(id);
      const addMovement = database.prepare("INSERT INTO inventory_movements(product_id,document_id,document_item_id,quantity_delta_milli,event_type) VALUES(?,?,?,?, 'void')");
      for (const item of items) {
        const original = database.prepare("SELECT quantity_delta_milli FROM inventory_movements WHERE document_item_id=? AND event_type IN ('purchase','sale')").get(item.id);
        if (original) addMovement.run(item.product_id, id, item.id, -original.quantity_delta_milli);
      }
      database.prepare("UPDATE documents SET status='voided', void_reason=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?").run(reason, id);
      const productIds = [...new Set(items.map(i => i.product_id))];
      const latest = database.prepare(`SELECT i.product_id, i.unit_price_irr FROM document_items i JOIN documents d ON d.id=i.document_id
        WHERE d.document_type='purchase' AND d.status='finalized' AND i.product_id=?
        ORDER BY d.finalized_at DESC, d.id DESC, i.id DESC LIMIT 1`);
      const update = database.prepare("UPDATE products SET purchase_price_irr=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?");
      for (const productId of productIds) {
        const row = latest.get(productId);
        update.run(row ? row.unit_price_irr : null, productId);
      }
      return { id, status: 'voided' };
    })();
  });
  ipcMain.handle('inventory:list', () => database.prepare(`SELECT p.id, p.code, p.name, p.unit,
    COALESCE(SUM(m.quantity_delta_milli),0) AS quantityMilli,
    p.purchase_price_irr AS latestPurchasePriceIrr,
    CASE WHEN p.purchase_price_irr IS NULL THEN NULL ELSE p.purchase_price_irr * COALESCE(SUM(m.quantity_delta_milli),0) / 1000 END AS valuationIrr
    FROM products p LEFT JOIN inventory_movements m ON m.product_id=p.id
    WHERE p.is_active=1 GROUP BY p.id ORDER BY p.name COLLATE NOCASE`).all());
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
