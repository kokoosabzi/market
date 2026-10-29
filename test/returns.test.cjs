const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../electron/database.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-returns-'));
  const db = openDatabase(path.join(dir, 'data', 'market.sqlite'), path.join(__dirname, '../electron/migrations'));
  return { dir, db };
}
test('return rows link to original document lines and retain status history', t => {
  const f = fixture(); t.after(() => { f.db.close(); fs.rmSync(f.dir, { recursive: true, force: true }); });
  assert.equal(f.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 4);
  const productId = f.db.prepare('INSERT INTO products(code,name,sale_price_irr) VALUES(?,?,?)').run('R-1','کالای برگشتی',1000).lastInsertRowid;
  const documentId = f.db.prepare("INSERT INTO documents(document_type,document_number,document_date,status,finalized_at) VALUES('sale','SAL-00000001','2026-10-29','finalized','2026-10-29T12:00:00Z')").run().lastInsertRowid;
  const itemId = f.db.prepare("INSERT INTO document_items(document_id,product_id,quantity_milli,unit_price_irr,gross_irr,discount_irr,tax_irr,total_irr) VALUES(?,?,3000,1000,3000,0,0,3000)").run(documentId,productId).lastInsertRowid;
  const returnId = f.db.prepare("INSERT INTO returns(return_number,return_type,source_document_id,return_date,reason) VALUES('RET-1','sale',?,'2026-10-29','کالای معیوب')").run(documentId).lastInsertRowid;
  f.db.prepare('INSERT INTO return_items(return_id,source_document_item_id,product_id,quantity_milli,amount_irr) VALUES(?,?,?,?,?)').run(returnId,itemId,productId,1000,1000);
  f.db.prepare('UPDATE returns SET status=? WHERE id=?').run('finalized',returnId);
  f.db.prepare('INSERT INTO return_movements(return_id,return_item_id,product_id,quantity_delta_milli) VALUES(?,?,?,?)').run(returnId,1,productId,1000);
  assert.equal(f.db.prepare('SELECT SUM(quantity_delta_milli) AS qty FROM return_movements WHERE product_id=?').get(productId).qty,1000);
  assert.throws(() => f.db.prepare("INSERT INTO return_movements(return_id,return_item_id,product_id,quantity_delta_milli) VALUES(?,?,?,?)").run(returnId,1,productId,1000));
  assert.equal(f.db.prepare('SELECT source_document_id FROM returns WHERE id=?').get(returnId).source_document_id,documentId);
});
