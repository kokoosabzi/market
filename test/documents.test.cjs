const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../electron/database.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-docs-'));
  const db = openDatabase(path.join(dir, 'data', 'market.sqlite'), path.join(__dirname, '../electron/migrations'));
  return { dir, db };
}
test('document and inventory schema preserve integer quantities and document history', t => {
  const f = fixture(); t.after(() => { f.db.close(); fs.rmSync(f.dir, { recursive: true, force: true }); });
  assert.equal(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 3);
  const productId = f.db.prepare('INSERT INTO products(code,name,sale_price_irr) VALUES(?,?,?)').run('D-1','کالای آزمایشی',5000).lastInsertRowid;
  const documentId = f.db.prepare("INSERT INTO documents(document_type,document_number,document_date,status) VALUES('purchase','BUY-00000001','2026-10-29','finalized')").run().lastInsertRowid;
  const itemId = f.db.prepare("INSERT INTO document_items(document_id,product_id,quantity_milli,unit_price_irr,gross_irr,discount_irr,tax_irr,total_irr) VALUES(?,?,1000,3000,3000,0,0,3000)").run(documentId,productId).lastInsertRowid;
  f.db.prepare("INSERT INTO inventory_movements(product_id,document_id,document_item_id,quantity_delta_milli,event_type) VALUES(?,?,?,1000,'purchase')").run(productId,documentId,itemId);
  assert.equal(f.db.prepare('SELECT SUM(quantity_delta_milli) AS qty FROM inventory_movements WHERE product_id=?').get(productId).qty,1000);
  assert.throws(() => f.db.prepare("INSERT INTO inventory_movements(product_id,document_id,document_item_id,quantity_delta_milli,event_type) VALUES(?,?,?,1000,'purchase')").run(productId,documentId,itemId));
  f.db.prepare("UPDATE documents SET status='voided', void_reason='test reason' WHERE id=?").run(documentId);
  assert.equal(f.db.prepare('SELECT document_number FROM documents WHERE id=?').get(documentId).document_number,'BUY-00000001');
  assert.throws(() => f.db.prepare("INSERT INTO documents(document_type,document_number,document_date) VALUES('purchase','BUY-00000001','2026-10-30')").run());
});
test('draft document item writes can be rolled back atomically', t => {
  const f = fixture(); t.after(() => { f.db.close(); fs.rmSync(f.dir, { recursive: true, force: true }); });
  const productId = f.db.prepare('INSERT INTO products(code,name,sale_price_irr) VALUES(?,?,?)').run('D-2','کالای دوم',0).lastInsertRowid;
  const insert = f.db.transaction(() => {
    const doc = f.db.prepare("INSERT INTO documents(document_type,document_number,document_date) VALUES('sale','DRAFT-TX','2026-10-29')").run();
    f.db.prepare('INSERT INTO document_items(document_id,product_id,quantity_milli,unit_price_irr,gross_irr,discount_irr,tax_irr,total_irr) VALUES(?,?,1000,0,0,0,0,0)').run(doc.lastInsertRowid,productId);
    throw new Error('rollback');
  });
  assert.throws(() => insert());
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE document_number='DRAFT-TX'").get().n,0);
});
