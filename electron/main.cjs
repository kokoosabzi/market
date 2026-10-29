const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openDatabase } = require('./database.cjs');
const { roundRatio, calculateLine } = require('./domain.cjs');

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
    if (!['theme', 'money_display', 'tax_rate_bp'].includes(key)) throw new Error('این تنظیم قابل تغییر نیست.');
    if (key === 'theme' && !['light', 'dark', 'system'].includes(value)) throw new Error('پوسته انتخاب‌شده معتبر نیست.');
    if (key === 'money_display' && !['irr', 'irt'].includes(value)) throw new Error('واحد نمایش معتبر نیست.');
    if (key === 'tax_rate_bp' && (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 10000)) throw new Error('نرخ مالیات باید بین صفر تا ۱۰۰ درصد باشد.');
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
    const salePrice = requireMoney(payload.salePriceIrr ?? 0, 'قیمت فروش');
    const minStock = Number(payload.minStockMilli ?? 0);
    if (!Number.isSafeInteger(minStock) || minStock < 0) throw new Error('حداقل موجودی معتبر نیست.');
    const description = typeof payload.description === 'string' ? payload.description.trim().slice(0, 1000) : '';
    const id = payload.id ? requireId(payload.id) : null;
    if (categoryId && !database.prepare('SELECT 1 FROM categories WHERE id = ? AND is_active = 1').get(categoryId)) throw new Error('دسته‌بندی انتخاب‌شده فعال نیست.');
    if (id) {
      database.prepare(`UPDATE products SET code=?, name=?, category_id=?, unit=?, sale_price_irr=?,
        min_stock_milli=?, description=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?`)
        .run(code, name, categoryId, unit, salePrice, minStock, description, id);
      return database.prepare('SELECT id, code, name FROM products WHERE id = ?').get(id);
    }
    const result = database.prepare(`INSERT INTO products (code,name,category_id,unit,sale_price_irr,min_stock_milli,description)
      VALUES (?,?,?,?,?,?,?)`).run(code, name, categoryId, unit, salePrice, minStock, description);
    return database.prepare('SELECT id, code, name FROM products WHERE id = ?').get(result.lastInsertRowid);
  });
  ipcMain.handle('catalog:set-product-active', (_event, payload = {}) => {
    const id = requireId(payload.id);
    const active = payload.active === true ? 1 : 0;
    database.prepare("UPDATE products SET is_active=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?").run(active, id);
    return { id, active: Boolean(active) };
  });

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
      const discountType = item.discountType || 'none';
      const discountValue = Number(item.discountValue || 0);
      const configuredTax = Number(database.prepare("SELECT setting_value FROM app_settings WHERE setting_key='tax_rate_bp'").get()?.setting_value || '0');
      const taxRate = item.taxRateBp === undefined ? configuredTax : Number(item.taxRateBp || 0);
      let amounts;
      try { amounts = calculateLine({ quantityMilli, unitPriceIrr: unitPrice, discountType, discountValue, taxRateBp: taxRate }); }
      catch (error) { throw new Error('اطلاعات مبلغ ردیف ' + (index + 1) + ' معتبر نیست: ' + error.message); }
      return { product, productId, quantityMilli, unitPrice, discountType, discountValue, taxRate, ...amounts };
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
      i.gross_irr AS grossIrr, i.discount_type AS discountType, i.discount_value AS discountValue, i.tax_rate_bp AS taxRateBp,
      i.discount_irr AS discountIrr, i.tax_irr AS taxIrr, i.total_irr AS totalIrr,
      i.unit_cost_snapshot_irr AS unitCostSnapshotIrr, i.cost_status AS costStatus
      FROM document_items i JOIN products p ON p.id=i.product_id WHERE i.document_id=? ORDER BY i.id`).all(id);
    return doc;
  });
  ipcMain.handle('documents:save-draft', (_event, payload = {}) => {
    const type = payload.type;
    if (!['purchase', 'sale'].includes(type)) throw new Error('نوع سند معتبر نیست.');
    const date = requireText(payload.documentDate, 'تاریخ سند', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw new Error('تاریخ سند معتبر نیست.');
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
  ipcMain.handle('documents:preview-finalize', (_event, payload = {}) => {
    const id = requireId(payload.id);
    const doc = database.prepare("SELECT document_type AS type, status FROM documents WHERE id=?").get(id);
    if (!doc || doc.status !== 'draft') throw new Error('فقط پیش‌نویس قابل بررسی است.');
    if (doc.type !== 'sale') return { warnings: [] };
    const rows = database.prepare(`SELECT i.product_id AS productId, i.quantity_milli AS quantityMilli, p.name AS productName,
      COALESCE((SELECT SUM(quantity_delta_milli) FROM inventory_movements WHERE product_id=p.id),0) +
      COALESCE((SELECT SUM(quantity_delta_milli) FROM return_movements WHERE product_id=p.id),0) AS stockMilli
      FROM document_items i JOIN products p ON p.id=i.product_id WHERE i.document_id=?`).all(id);
    const totals = new Map();
    for (const row of rows) {
      const current = totals.get(row.productId) || { productName: row.productName, quantityMilli: 0, stockMilli: row.stockMilli };
      current.quantityMilli += row.quantityMilli; totals.set(row.productId, current);
    }
    return { warnings: [...totals.values()].filter(row => row.stockMilli < row.quantityMilli) };
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
      const warnings = [];
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
          if (currentStock < item.quantity_milli) warnings.push({ productId: item.product_id, productName: database.prepare('SELECT name FROM products WHERE id=?').get(item.product_id).name, stockBeforeMilli: currentStock, soldMilli: item.quantity_milli });
          const costStatus = cost === null ? 'unknown' : currentStock < item.quantity_milli ? 'estimated' : 'known';
          updateCost.run(cost, costStatus, item.id);
          addMovement.run(item.product_id, id, item.id, -item.quantity_milli, 'sale');
        }
      }
      database.prepare("UPDATE documents SET status='finalized', finalized_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?").run(id);
      return { id, documentNumber: number, status: 'finalized', warnings };
    })();
  });
  ipcMain.handle('documents:void', (_event, payload = {}) => {
    const id = requireId(payload.id);
    const reason = requireText(payload.reason, 'علت ابطال', 500);
    return database.transaction(() => {
      const doc = database.prepare('SELECT * FROM documents WHERE id=?').get(id);
      if (!doc || doc.status !== 'finalized') throw new Error('فقط سند نهایی قابل ابطال است.');
      const items = database.prepare('SELECT * FROM document_items WHERE document_id=?').all(id);
      const hasReturns = database.prepare("SELECT 1 FROM returns WHERE source_document_id=? AND status='finalized' LIMIT 1").get(id);
      if (hasReturns) throw new Error('این سند برگشت قطعی دارد؛ ابتدا باید از مسیر اصلاحی سازگار اقدام شود.');
      const dependent = database.prepare(`SELECT 1 FROM document_items target
        JOIN document_items later ON later.product_id=target.product_id
        JOIN documents d ON d.id=later.document_id
        WHERE target.document_id=? AND d.status='finalized' AND d.id>? LIMIT 1`).get(id, id);
      if (dependent) throw new Error('برای ایمنی، ابتدا اثر اسناد قطعی بعدی روی همین کالاها را بررسی کنید؛ ابطال مستقیم مسدود شد.');
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

  ipcMain.handle('returns:list-eligible-items', (_event, payload = {}) => {
    const sourceId = requireId(payload.sourceDocumentId);
    const source = database.prepare("SELECT id, document_type AS type, document_number AS documentNumber, status FROM documents WHERE id=?").get(sourceId);
    if (!source || source.status !== 'finalized') throw new Error('فقط سند قطعی و معتبر قابل برگشت است.');
    return { source, items: database.prepare(`SELECT i.id AS sourceDocumentItemId, i.product_id AS productId,
      p.code AS productCode, p.name AS productName, p.unit, i.quantity_milli AS originalQuantityMilli,
      i.unit_price_irr AS unitPriceIrr,
      i.quantity_milli - COALESCE((SELECT SUM(ri.quantity_milli) FROM return_items ri JOIN returns r ON r.id=ri.return_id
        WHERE ri.source_document_item_id=i.id AND r.status='finalized'),0) AS returnableQuantityMilli
      FROM document_items i JOIN products p ON p.id=i.product_id WHERE i.document_id=? ORDER BY i.id`).all(sourceId) };
  });
  ipcMain.handle('returns:list', () => database.prepare(`SELECT r.id, r.return_number AS returnNumber, r.return_type AS type,
    r.source_document_id AS sourceDocumentId, d.document_number AS sourceDocumentNumber, r.return_date AS returnDate,
    r.status, r.reason, r.void_reason AS voidReason, (SELECT COUNT(*) FROM return_items ri WHERE ri.return_id=r.id) AS itemCount
    FROM returns r JOIN documents d ON d.id=r.source_document_id ORDER BY r.id DESC LIMIT 200`).all());
  ipcMain.handle('returns:create-draft', (_event, payload = {}) => {
    const sourceId = requireId(payload.sourceDocumentId);
    const date = requireText(payload.returnDate, 'تاریخ برگشت', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw new Error('تاریخ برگشت معتبر نیست.');
    const reason = requireText(payload.reason, 'علت برگشت', 500);
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 200) throw new Error('حداقل یک قلم برگشت لازم است.');
    return database.transaction(() => {
      const source = database.prepare("SELECT * FROM documents WHERE id=? AND status='finalized'").get(sourceId);
      if (!source) throw new Error('سند اصلی قطعی و معتبر نیست.');
      const returnId = database.prepare(`INSERT INTO returns(return_number,return_type,source_document_id,return_date,reason)
        VALUES(?,?,?,?,?)`).run('TEMP-RETURN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), source.document_type, sourceId, date, reason).lastInsertRowid;
      database.prepare('UPDATE returns SET return_number=? WHERE id=?').run('RET-' + String(returnId).padStart(8, '0'), returnId);
      const insert = database.prepare('INSERT INTO return_items(return_id,source_document_item_id,product_id,quantity_milli,amount_irr) VALUES(?,?,?,?,?)');
      for (const [index, row] of payload.items.entries()) {
        const sourceItemId = requireId(row.sourceDocumentItemId);
        const original = database.prepare('SELECT * FROM document_items WHERE id=? AND document_id=?').get(sourceItemId, sourceId);
        if (!original) throw new Error('قلم برگشت در سند اصلی وجود ندارد.');
        const quantity = Number(row.quantityMilli);
        if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('مقدار برگشت ردیف ' + (index + 1) + ' معتبر نیست.');
        const product = database.prepare('SELECT unit FROM products WHERE id=?').get(original.product_id);
        if (['عدد', 'بسته', 'سرویس'].includes(product.unit) && quantity % 1000 !== 0) throw new Error('مقدار کالای شمارشی باید عدد صحیح باشد.');
        const returned = database.prepare(`SELECT COALESCE(SUM(ri.quantity_milli),0) AS qty FROM return_items ri JOIN returns r ON r.id=ri.return_id
          WHERE ri.source_document_item_id=? AND r.status IN ('draft','finalized')`).get(sourceItemId).qty;
        if (returned + quantity > original.quantity_milli) throw new Error('مقدار برگشتی از مقدار خالص قلم اصلی بیشتر است.');
        const amount = roundRatio(BigInt(original.total_irr) * BigInt(quantity), BigInt(original.quantity_milli));
        insert.run(returnId, sourceItemId, original.product_id, quantity, amount);
      }
      return { id: returnId, returnNumber: 'RET-' + String(returnId).padStart(8, '0'), status: 'draft' };
    })();
  });
  ipcMain.handle('returns:finalize', (_event, payload = {}) => {
    const id = requireId(payload.id);
    return database.transaction(() => {
      const ret = database.prepare('SELECT * FROM returns WHERE id=?').get(id);
      if (!ret || ret.status !== 'draft') throw new Error('فقط پیش‌نویس برگشت قابل نهایی‌سازی است.');
      const source = database.prepare("SELECT * FROM documents WHERE id=? AND status='finalized'").get(ret.source_document_id);
      if (!source) throw new Error('سند اصلی دیگر معتبر نیست.');
      const items = database.prepare('SELECT * FROM return_items WHERE return_id=?').all(id);
      if (!items.length) throw new Error('برگشت بدون قلم قابل نهایی‌سازی نیست.');
      for (const item of items) {
        const already = database.prepare(`SELECT COALESCE(SUM(ri.quantity_milli),0) AS qty FROM return_items ri JOIN returns r ON r.id=ri.return_id
          WHERE ri.source_document_item_id=? AND r.status='finalized'`).get(item.source_document_item_id).qty;
        const original = database.prepare('SELECT quantity_milli FROM document_items WHERE id=?').get(item.source_document_item_id);
        if (already + item.quantity_milli > original.quantity_milli) throw new Error('مقدار برگشتی در اسناد دیگر تغییر کرده؛ این برگشت را دوباره بررسی کنید.');
      }
      const movement = database.prepare('INSERT INTO return_movements(return_id,return_item_id,product_id,quantity_delta_milli) VALUES(?,?,?,?)');
      for (const item of items) movement.run(id, item.id, item.product_id, ret.return_type === 'purchase' ? -item.quantity_milli : item.quantity_milli);
      database.prepare("UPDATE returns SET status='finalized', finalized_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id=?").run(id);
      return { id, returnNumber: ret.return_number, status: 'finalized' };
    })();
  });

  function reportRows(type, from = '', to = '') {
    if (type === 'inventory') return database.prepare(`SELECT p.code AS 'کد کالا', p.name AS 'نام کالا', p.unit AS 'واحد',
      COALESCE(m.quantityMilli,0) AS 'موجودی در هزارم واحد', p.purchase_price_irr AS 'آخرین قیمت خرید ریال',
      CASE WHEN p.purchase_price_irr IS NULL THEN NULL ELSE p.purchase_price_irr * COALESCE(m.quantityMilli,0) / 1000 END AS 'ارزش موجودی ریال'
      FROM products p LEFT JOIN (
        SELECT product_id, SUM(quantity_delta_milli) AS quantityMilli FROM (
          SELECT product_id, quantity_delta_milli FROM inventory_movements
          UNION ALL SELECT product_id, quantity_delta_milli FROM return_movements
        ) GROUP BY product_id
      ) m ON m.product_id=p.id ORDER BY p.name COLLATE NOCASE`).all();
    if (type === 'purchase' || type === 'sale') return database.prepare(`SELECT document_number AS 'شماره سند', document_date AS 'تاریخ', party_name AS 'طرف معامله',
      status AS 'وضعیت', subtotal_irr AS 'جمع ناخالص ریال', discount_irr AS 'تخفیف ریال', tax_irr AS 'مالیات ریال', total_irr AS 'جمع کل ریال'
      FROM documents WHERE document_type=? AND (?='' OR document_date>=?) AND (?='' OR document_date<=?) ORDER BY id DESC`).all(type, from, from, to, to);
    if (type === 'returns') return database.prepare(`SELECT r.return_number AS 'شماره برگشت', r.return_type AS 'نوع', d.document_number AS 'سند اصلی',
      r.return_date AS 'تاریخ', r.status AS 'وضعیت', r.reason AS 'علت',
      (SELECT COALESCE(SUM(amount_irr),0) FROM return_items WHERE return_id=r.id) AS 'مبلغ ریال'
      FROM returns r JOIN documents d ON d.id=r.source_document_id
      WHERE (?='' OR r.return_date>=?) AND (?='' OR r.return_date<=?) ORDER BY r.id DESC`).all(from, from, to, to);
    throw new Error('نوع گزارش معتبر نیست.');
  }
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  ipcMain.handle('reports:export-csv', async (_event, payload = {}) => {
    const type = payload.type;
    const rows = reportRows(type, typeof payload.from === 'string' ? payload.from : '', typeof payload.to === 'string' ? payload.to : '');
    const headers = rows.length ? Object.keys(rows[0]) : (type === 'inventory'
      ? ['کد کالا','نام کالا','واحد','موجودی در هزارم واحد','آخرین قیمت خرید ریال','ارزش موجودی ریال']
      : ['شماره سند','تاریخ','طرف معامله','وضعیت','جمع کل ریال']);
    const csv = '\uFEFF' + [headers, ...rows.map(row => headers.map(header => row[header]))].map(row => row.map(csvCell).join(',')).join('\r\n');
    const choice = await dialog.showSaveDialog(mainWindow, { title: 'ذخیره گزارش CSV', defaultPath: 'Market-' + type + '-' + new Date().toISOString().slice(0,10) + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    fs.writeFileSync(choice.filePath, csv, 'utf8');
    return { canceled: false, filePath: choice.filePath, count: rows.length };
  });
  ipcMain.handle('reports:export-pdf', async (_event, payload = {}) => {
    const type = payload.type;
    const rows = reportRows(type);
    const headers = rows.length ? Object.keys(rows[0]) : ['گزارش', 'تعداد'];
    const body = rows.map(row => '<tr>' + headers.map(h => '<td>' + String(row[h] ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])) + '</td>').join('') + '</tr>').join('');
    const head = headers.map(h => '<th>' + String(h).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])) + '</th>').join('');
    const html = '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>body{font-family:Tahoma,sans-serif;padding:24px;color:#172033}h1{font-size:20px}p{color:#667085}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #d8deea;padding:7px;text-align:right}th{background:#eef1fa}tr{break-inside:avoid}</style><h1>گزارش Market</h1><p>نوع گزارش: ' + type + ' · تاریخ تهیه: ' + new Date().toLocaleDateString('fa-IR') + '</p><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></html>';
    const choice = await dialog.showSaveDialog(mainWindow, { title: 'ذخیره گزارش PDF', defaultPath: 'Market-' + type + '-' + new Date().toISOString().slice(0,10) + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    const printWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    try {
      await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: type === 'inventory' });
      fs.writeFileSync(choice.filePath, pdf);
    } finally { printWindow.destroy(); }
    return { canceled: false, filePath: choice.filePath, count: rows.length };
  });
  ipcMain.handle('backup:create', async () => {
    const choice = await dialog.showSaveDialog(mainWindow, { title: 'ذخیرهٔ پشتیبان Market', defaultPath: 'Market-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite', filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }] });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    await database.backup(choice.filePath);
    const verify = new Database(choice.filePath, { readonly: true, fileMustExist: true });
    try {
      const check = verify.pragma('quick_check');
      if (!check.length || check[0].quick_check !== 'ok') throw new Error('اعتبارسنجی پشتیبان ناموفق بود.');
      if (verify.prepare("SELECT meta_value FROM app_meta WHERE meta_key='application_id'").get()?.meta_value !== 'market-desktop') throw new Error('فایل پشتیبان متعلق به Market نیست.');
    } finally { verify.close(); }
    return { canceled: false, filePath: choice.filePath };
  });
  ipcMain.handle('backup:restore', async () => {
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'انتخاب فایل پشتیبان', properties: ['openFile'], filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }] });
    if (choice.canceled || !choice.filePaths?.[0]) return { canceled: true };
    const selected = path.resolve(choice.filePaths[0]);
    const currentPath = path.join(app.getPath('userData'), 'data', 'market.sqlite');
    if (selected === path.resolve(currentPath)) throw new Error('برای بازیابی، فایل پشتیبان جداگانه انتخاب کنید.');
    const source = new Database(selected, { readonly: true, fileMustExist: true });
    let sourceVersion;
    try {
      const check = source.pragma('quick_check');
      if (!check.length || check[0].quick_check !== 'ok') throw new Error('فایل انتخاب‌شده سالم نیست.');
      if (source.prepare("SELECT meta_value FROM app_meta WHERE meta_key='application_id'").get()?.meta_value !== 'market-desktop') throw new Error('فایل انتخاب‌شده پشتیبان معتبر Market نیست.');
      sourceVersion = source.prepare('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations').get().v;
      const localMax = require('./database.cjs').listMigrations(path.join(__dirname, 'migrations')).at(-1)?.version || 0;
      if (sourceVersion > localMax) throw new Error('این پشتیبان از نسخهٔ برنامه جدیدتر است و قابل بازیابی نیست.');
    } finally { source.close(); }
    const dataDir = path.dirname(currentPath);
    const backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyPath = path.join(backupDir, 'before-restore-' + stamp + '.sqlite');
    await database.backup(safetyPath);
    const stagedPath = currentPath + '.restore-staged';
    const previousPath = currentPath + '.restore-previous';
    fs.copyFileSync(selected, stagedPath);
    database.close(); database = null;
    try {
      if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
      fs.renameSync(currentPath, previousPath);
      fs.renameSync(stagedPath, currentPath);
      database = openDatabase(currentPath, path.join(__dirname, 'migrations'));
      if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
    } catch (error) {
      if (database?.open) database.close();
      database = null;
      if (fs.existsSync(currentPath)) fs.unlinkSync(currentPath);
      if (fs.existsSync(previousPath)) fs.renameSync(previousPath, currentPath);
      database = openDatabase(currentPath, path.join(__dirname, 'migrations'));
      throw error;
    } finally {
      if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
    }
    return { canceled: false, safetyPath, schemaVersion: database.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v };
  });

  ipcMain.handle('returns:void', (_event, payload = {}) => {
    const id = requireId(payload.id);
    const reason = requireText(payload.reason, 'علت ابطال برگشت', 500);
    return database.transaction(() => {
      const ret = database.prepare('SELECT * FROM returns WHERE id=?').get(id);
      if (!ret || ret.status !== 'finalized') throw new Error('فقط برگشت قطعی قابل ابطال است.');
      const items = database.prepare('SELECT * FROM return_items WHERE return_id=?').all(id);
      const reverse = database.prepare("INSERT INTO return_movements(return_id,return_item_id,product_id,quantity_delta_milli,event_type) VALUES(?,?,?,?,'void')");
      for (const item of items) {
        const movement = database.prepare("SELECT quantity_delta_milli FROM return_movements WHERE return_item_id=? AND event_type='return'").get(item.id);
        if (movement) reverse.run(id, item.id, item.product_id, -movement.quantity_delta_milli);
      }
      database.prepare("UPDATE returns SET status='voided', void_reason=? WHERE id=?").run(reason, id);
      return { id, returnNumber: ret.return_number, status: 'voided' };
    })();
  });
  ipcMain.handle('inventory:list', () => database.prepare(`SELECT p.id, p.code, p.name, p.unit,
    COALESCE(m.quantityMilli,0) AS quantityMilli,
    p.purchase_price_irr AS latestPurchasePriceIrr,
    CASE WHEN p.purchase_price_irr IS NULL THEN NULL ELSE p.purchase_price_irr * COALESCE(m.quantityMilli,0) / 1000 END AS valuationIrr
    FROM products p LEFT JOIN (
      SELECT product_id, SUM(quantity_delta_milli) AS quantityMilli FROM (
        SELECT product_id, quantity_delta_milli FROM inventory_movements
        UNION ALL SELECT product_id, quantity_delta_milli FROM return_movements
      ) GROUP BY product_id
    ) m ON m.product_id=p.id
    WHERE p.is_active=1 ORDER BY p.name COLLATE NOCASE`).all());
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
