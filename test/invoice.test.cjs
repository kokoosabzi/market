const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, renderInvoice } = require('../electron/invoice.cjs');

const fixture = {
  id: 7, type: 'sale', documentNumber: 'SAL-00000007', documentDate: '2026-11-02',
  status: 'finalized', partyName: '<Buyer>', notes: '<script>alert(1)</script>',
  subtotalIrr: 2500, discountIrr: 0, taxIrr: 0, totalIrr: 2500,
  items: [{ productCode: 'A-1', productName: '<img src=x onerror=alert(1)>', unit: 'عدد',
    quantityMilli: 2000, unitPriceIrr: 1250, totalIrr: 2500 }]
};

test('invoice HTML escapes every user-controlled text field', () => {
  const html = renderInvoice(fixture, 'a4');
  assert.match(html, /&lt;Buyer&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('A4 and thermal invoice layouts share document data and select page geometry', () => {
  const a4 = renderInvoice(fixture, 'a4');
  const thermal = renderInvoice(fixture, 'thermal80');
  assert.match(a4, /@page\{size:A4/);
  assert.match(thermal, /@page\{size:80mm auto/);
  for (const html of [a4, thermal]) {
    assert.match(html, /SAL-00000007/);
    assert.match(html, /۲٬۵۰۰ ریال/);
  }
});

test('voided invoice is visibly marked and unsupported formats are rejected', () => {
  const html = renderInvoice({ ...fixture, status: 'voided' }, 'a4');
  assert.match(html, /این سند باطل شده است/);
  assert.throws(() => renderInvoice(fixture, 'letter'), /قالب فاکتور/);
  assert.throws(() => renderInvoice({ ...fixture, type: 'purchase' }, 'a4'), /اطلاعات فاکتور/);
});

test('escapeHtml encodes all HTML-sensitive characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});
