'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function faNumber(value, digits = 0) {
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value) || 0);
}
function money(value) { return faNumber(value) + ' ریال'; }
function renderInvoice(doc, format = 'a4') {
  if (!doc || doc.type !== 'sale' || !Array.isArray(doc.items) || !doc.items.length) throw new Error('اطلاعات فاکتور فروش معتبر نیست.');
  if (!['a4', 'thermal80'].includes(format)) throw new Error('قالب فاکتور معتبر نیست.');
  const thermal = format === 'thermal80';
  const rows = doc.items.map((item, index) => `<tr>
    <td class="index">${faNumber(index + 1)}</td>
    <td><strong>${escapeHtml(item.productName)}</strong><small>${escapeHtml(item.productCode)} · ${escapeHtml(item.unit)}</small></td>
    <td class="number">${faNumber(Number(item.quantityMilli) / 1000, 3)}</td>
    <td class="number">${money(item.unitPriceIrr)}</td>
    <td class="number">${money(item.totalIrr)}</td>
  </tr>`).join('');
  const title = doc.status === 'voided' ? 'نسخهٔ باطل‌شده' : 'فاکتور فروش';
  const status = doc.status === 'voided' ? 'باطل‌شده' : 'قطعی';
  const notes = doc.notes ? `<section class="notes"><b>توضیحات:</b> ${escapeHtml(doc.notes)}</section>` : '';
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(doc.documentNumber)}</title><style>
    @page{size:${thermal ? '80mm auto' : 'A4'};margin:${thermal ? '4mm' : '14mm'}}
    *{box-sizing:border-box}body{font-family:Tahoma,"Segoe UI",sans-serif;color:#172033;margin:0;font-size:${thermal ? '10px' : '12px'}}
    h1{font-size:${thermal ? '17px' : '22px'};margin:0 0 5px}.muted{color:#667085}.head{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #26345b;padding-bottom:12px;margin-bottom:14px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:12px 0}.meta div{padding:6px;background:#f5f6fa;border-radius:4px}
    table{width:100%;border-collapse:collapse;font-size:${thermal ? '9px' : '11px'}}th,td{border:1px solid #d8deea;padding:${thermal ? '4px 3px' : '8px 6px'};text-align:right;vertical-align:top}
    th{background:#eef1fa}.number{white-space:nowrap;text-align:left;direction:ltr}.index{width:22px}small{display:block;color:#667085;font-size:9px;margin-top:3px}
    .totals{width:${thermal ? '100%' : '48%'};margin:14px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:5px 2px;border-bottom:1px solid #e5e7eb}
    .grand{font-weight:bold;font-size:${thermal ? '13px' : '16px'};border-top:2px solid #26345b}.notes{margin-top:16px;padding:8px;background:#f7f8fb}
    .foot{margin-top:22px;padding-top:8px;border-top:1px dashed #98a2b3;text-align:center;color:#667085;font-size:9px}
    .void{border:2px solid #b42318;color:#b42318;padding:6px;text-align:center;font-weight:bold;margin:10px 0}
    ${thermal ? '.head{display:block;text-align:center}.meta{grid-template-columns:1fr}.totals{width:100%}table th:nth-child(4),table td:nth-child(4){display:none}' : ''}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
    <header class="head"><div><h1>Market · فاکتور فروش</h1><span class="muted">نسخهٔ چاپی سند فروش</span></div><div><b>${escapeHtml(doc.documentNumber)}</b><small>وضعیت: ${status}</small></div></header>
    ${doc.status === 'voided' ? '<div class="void">این سند باطل شده است</div>' : ''}
    <section class="meta"><div><b>تاریخ:</b> ${escapeHtml(doc.documentDate)}</div><div><b>خریدار:</b> ${escapeHtml(doc.partyName || 'مشتری حضوری')}</div></section>
    <table><thead><tr><th>#</th><th>شرح کالا</th><th>تعداد</th><th>قیمت واحد</th><th>مبلغ ردیف</th></tr></thead><tbody>${rows}</tbody></table>
    <section class="totals"><div><span>جمع کالاها</span><b>${money(doc.subtotalIrr)}</b></div><div><span>تخفیف</span><b>${money(doc.discountIrr)}</b></div><div><span>مالیات</span><b>${money(doc.taxIrr)}</b></div><div class="grand"><span>مبلغ نهایی</span><b>${money(doc.totalIrr)}</b></div></section>
    ${notes}<footer class="foot">با سپاس از خرید شما · Market</footer>
  </body></html>`;
}
module.exports = { escapeHtml, renderInvoice };
