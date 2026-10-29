const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../electron/database.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-catalog-'));
  const db = openDatabase(path.join(dir, 'data', 'market.sqlite'), path.join(__dirname, '../electron/migrations'));
  return { dir, db };
}
test('catalog migration creates unique product codes and category names', t => {
  const f = fixture(); t.after(() => { f.db.close(); fs.rmSync(f.dir, { recursive: true, force: true }); });
  assert.equal(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 3);
  f.db.prepare('INSERT INTO categories(name) VALUES (?)').run('خوراکی');
  assert.throws(() => f.db.prepare('INSERT INTO categories(name) VALUES (?)').run('خوراکی'));
  f.db.prepare("INSERT INTO products(code,name,sale_price_irr) VALUES (?,?,?)").run('P-1', 'کالای نمونه', 12000);
  assert.throws(() => f.db.prepare("INSERT INTO products(code,name,sale_price_irr) VALUES (?,?,?)").run('p-1', 'کالای تکراری', 1000));
});
test('catalog enforces non-negative integer prices and keeps category reference valid', t => {
  const f = fixture(); t.after(() => { f.db.close(); fs.rmSync(f.dir, { recursive: true, force: true }); });
  assert.throws(() => f.db.prepare("INSERT INTO products(code,name,sale_price_irr) VALUES (?,?,?)").run('P-2', 'قیمت نامعتبر', -1));
  const category = f.db.prepare('INSERT INTO categories(name) VALUES (?)').run('ابزار');
  f.db.prepare("INSERT INTO products(code,name,category_id,sale_price_irr) VALUES (?,?,?,?)").run('P-3', 'پیچ‌گوشتی', category.lastInsertRowid, 25000);
  assert.equal(f.db.prepare('SELECT category_id FROM products WHERE code=?').get('P-3').category_id, category.lastInsertRowid);
});
