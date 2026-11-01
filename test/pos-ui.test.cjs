const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
for (const file of ['src/renderer.js', 'src/pos.js']) {
  test(file + ' parses as valid JavaScript', () => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  });
}

test('POS uses the constrained preload API and supports saved drafts and discounts', () => {
  const source = fs.readFileSync(path.join(root, 'src/pos.js'), 'utf8');
  for (const api of ['listProducts', 'listInventory', 'getSettings', 'saveDocumentDraft',
    'previewDocumentFinalization', 'finalizeDocument', 'getDocument']) {
    assert.match(source, new RegExp('marketApp\\.' + api + '\\s*\\('));
  }
  assert.match(source, /data-pos-discount-type/);
  assert.match(source, /data-pos-discount-value/);
  assert.match(source, /data-pos-edit/);
  assert.match(source, /stockMilli/);
  assert.match(source, /quantityMilli/);
  assert.match(source, /Number\.isSafeInteger\(milli\)/);
  assert.match(source, /preview\\.warnings/);
  assert.doesNotMatch(source, /require\(['"](?:electron|better-sqlite3)['"]\)/);
});
