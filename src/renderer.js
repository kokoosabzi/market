const $ = (id) => document.getElementById(id);
const state = { page: 'dashboard', theme: 'system', moneyDisplay: 'irr', products: [], categories: [] };
const pageTitles = { dashboard: 'نمای کلی', products: 'مدیریت کالاها', categories: 'دسته‌بندی‌ها', purchase: 'اسناد خرید', sale: 'اسناد فروش', inventory: 'وضعیت موجودی', returns: 'برگشت‌ها', reports: 'گزارش‌ها', backup: 'پشتیبان‌گیری', settings: 'تنظیمات' };
const digitsFa = (value) => String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const formatMoney = (value) => {
  if (value === null || value === undefined) return '—';
  const amount = state.moneyDisplay === 'irt' ? Math.round(Number(value) / 10) : Number(value);
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(amount) + (state.moneyDisplay === 'irt' ? ' تومان' : ' ریال');
};
function toast(message, error = false) {
  const el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : ''); el.textContent = message;
  $('toast-region').append(el); window.setTimeout(() => el.remove(), 4200);
}
function applyTheme(theme) {
  state.theme = theme; document.documentElement.dataset.theme = theme;
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.classList.toggle('selected', button.dataset.themeChoice === theme));
}
function applyMoneyDisplay(value) {
  state.moneyDisplay = value;
  document.querySelectorAll('[data-money-choice]').forEach(button => button.classList.toggle('selected', button.dataset.moneyChoice === value));
}
async function goTo(page) {
  if (!pageTitles[page]) return;
  state.page = page;
  document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== page + '-page'; });
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('page-title').textContent = pageTitles[page]; $('breadcrumb').textContent = 'فضای کاری / ' + pageTitles[page];
  if (page === 'products') await renderProducts();
  if (page === 'categories') await renderCategories();
  if (page === 'purchase' || page === 'sale') await renderDocuments(page);
  if (page === 'inventory') await renderInventory();
  if (page === 'returns') await renderReturns();
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
async function loadCategories() { state.categories = await window.marketApp.listCategories(); }
async function renderDashboard() {
  const [info, db, products, categories] = await Promise.all([
    window.marketApp.getAppInfo(), window.marketApp.getDatabaseStatus(),
    window.marketApp.listProducts({ activeOnly: false }), window.marketApp.listCategories(true)
  ]);
  $('app-version').textContent = 'نسخهٔ ' + info.version;
  $('database-status').textContent = db.connected ? 'آماده' : 'قطع';
  $('database-location').textContent = db.location;
  $('product-count').textContent = digitsFa(products.length);
  $('category-count').textContent = digitsFa(categories.length);
  $('schema-version').textContent = 'نسخهٔ ساختار ' + digitsFa(db.schemaVersion);
  $('settings-db-location').textContent = db.location;
}
async function renderProducts() {
  const search = $('product-search').value.trim();
  const rows = await window.marketApp.listProducts({ search, activeOnly: !$('show-inactive').checked });
  state.products = rows;
  const tbody = $('products-table');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">کالایی پیدا نشد. برای شروع، کالای جدید ثبت کنید.</td></tr>';
  } else {
    tbody.innerHTML = rows.map(p => `<tr>
      <td><span class="product-code">${escapeHtml(p.code)}</span></td><td><span class="product-name">${escapeHtml(p.name)}</span></td>
      <td class="muted-cell">${escapeHtml(p.categoryName || '—')}</td><td>${escapeHtml(p.unit)}</td>
      <td>${formatMoney(p.purchasePriceIrr)}</td><td>${formatMoney(p.salePriceIrr)}</td>
      <td><span class="status-pill ${p.isActive ? '' : 'inactive'}">${p.isActive ? 'فعال' : 'غیرفعال'}</span></td>
      <td><div class="row-actions"><button class="small-action" data-edit-product="${p.id}">ویرایش</button><button class="small-action" data-toggle-product="${p.id}" data-active="${p.isActive ? '1' : '0}">${p.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></div></td>
    </tr>`).join('');
  }
  $('products-summary').textContent = digitsFa(rows.length) + ' کالا در این فهرست نمایش داده می‌شود (حداکثر ۵۰۰ ردیف).';
}
async function renderCategories() {
  const rows = await window.marketApp.listCategories(true); state.categories = rows;
  $('categories-list').innerHTML = rows.length ? rows.map(c => `<article class="category-item"><div><strong>${escapeHtml(c.name)}</strong><small>شناسهٔ داخلی: ${digitsFa(c.id)}</small></div><span class="status-pill">فعال</span></article>`).join('') : '<div class="empty-cell">هنوز دسته‌بندی ثبت نشده است.</div>';
}
async function fillCategorySelect(selected = '') {
  await loadCategories();
  $('product-category').innerHTML = '<option value="">بدون دسته‌بندی</option>' + state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('product-category').value = String(selected || '');
}


async function renderReturns() {
  const rows = await window.marketApp.listReturns();
  $('returns-table').innerHTML = rows.length ? rows.map(r => '<tr><td><span class="product-code">' + escapeHtml(r.returnNumber) + '</span></td><td>' + (r.type === 'purchase' ? 'برگشت خرید' : 'برگشت فروش') + '</td><td>' + escapeHtml(r.sourceDocumentNumber) + '</td><td>' + escapeHtml(r.returnDate) + '<small class="date-jalali">' + escapeHtml(jalaliPreview(r.returnDate)) + '</small></td><td>' + escapeHtml(r.reason) + '</td><td><span class="status-pill ' + (r.status === 'finalized' ? '' : 'inactive') + '">' + (r.status === 'finalized' ? 'قطعی' : r.status === 'voided' ? 'باطل' : 'پیش‌نویس') + '</span></td><td>' + (r.status === 'draft' ? '<button class="small-action" data-finalize-return="' + r.id + '">تکمیل ثبت</button>' : '—') + '</td></tr>').join('') : '<tr><td colspan="7" class="empty-cell">هنوز برگشتی ثبت نشده است.</td></tr>';
}
async function openReturnDialog() {
  const [purchases, sales] = await Promise.all([window.marketApp.listDocuments('purchase'), window.marketApp.listDocuments('sale')]);
  const sources = [...purchases, ...sales].filter(d => d.status === 'finalized');
  $('return-form').reset(); $('return-form-error').hidden = true; $('return-source-items').innerHTML = '<p class="empty-cell">ابتدا سند اصلی را انتخاب کنید.</p>';
  $('return-date').value = localIsoDate(); $('return-jalali-preview').textContent = jalaliPreview($('return-date').value);
  $('return-source').innerHTML = '<option value="">انتخاب سند قطعی…</option>' + sources.map(d => '<option value="' + d.id + '">' + (purchases.some(p => p.id === d.id) ? 'خرید' : 'فروش') + ' · ' + escapeHtml(d.documentNumber) + ' · ' + escapeHtml(d.documentDate) + ' · ' + formatMoney(d.totalIrr) + '</option>').join('');
  $('return-dialog').showModal();
}
async function renderReturnableItems(sourceId) {
  if (!sourceId) { $('return-source-items').innerHTML = '<p class="empty-cell">ابتدا سند اصلی را انتخاب کنید.</p>'; return; }
  const data = await window.marketApp.listReturnableItems(Number(sourceId));
  $('return-source-items').innerHTML = '<div class="table-wrap"><table><thead><tr><th>کالا</th><th>مقدار اصلی</th><th>قابل برگشت</th><th>مقدار برگشتی</th></tr></thead><tbody>' + data.items.map(item => {
    const max = Number(item.returnableQuantityMilli || 0);
    const step = ['عدد','بسته','سرویس'].includes(item.unit) ? 1 : 0.001;
    return '<tr data-return-source-item="' + item.sourceDocumentItemId + '"><td>' + escapeHtml(item.productCode + ' · ' + item.productName) + '<small class="date-jalali">' + escapeHtml(item.unit) + '</small></td><td>' + quantityLabel(item.originalQuantityMilli) + '</td><td>' + quantityLabel(max) + '</td><td><input class="return-quantity" type="number" min="0" max="' + (max / 1000) + '" step="' + step + '" value="0" ' + (max === 0 ? 'disabled' : '') + ' aria-label="مقدار برگشتی"></td></tr>';
  }).join('') + '</tbody></table></div>';
}
async function submitReturn(event) {
  event.preventDefault(); $('save-return').disabled = true; $('return-form-error').hidden = true;
  try {
    const items = [...document.querySelectorAll('[data-return-source-item]')].map(row => ({
      sourceDocumentItemId: Number(row.dataset.returnSourceItem),
      quantityMilli: Math.round(Number(row.querySelector('.return-quantity').value || 0) * 1000)
    })).filter(item => item.quantityMilli > 0);
    const created = await window.marketApp.createReturnDraft({ sourceDocumentId: Number($('return-source').value), returnDate: $('return-date').value, reason: $('return-reason').value, items });
    const finalized = await window.marketApp.finalizeReturn(created.id);
    $('return-dialog').close(); toast('برگشت ' + finalized.returnNumber + ' قطعی شد.'); await renderReturns(); await renderInventory(); await renderDashboard();
  } catch(error) {
    $('return-form-error').textContent = error.message || 'ثبت برگشت ناموفق بود.'; $('return-form-error').hidden = false;
  } finally { $('save-return').disabled = false; }
}
async function exportReport(type, format) {
  try {
    const result = format === 'csv' ? await window.marketApp.exportCsv(type) : await window.marketApp.exportPdf(type);
    if (result.canceled) return;
    toast('گزارش ذخیره شد: ' + result.filePath + (result.count !== undefined ? ' · ' + digitsFa(result.count) + ' ردیف' : ''));
  } catch(error) { toast(error.message || 'خروجی گزارش ناموفق بود.', true); }
}
function localIsoDate() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}
function jalaliPreview(iso) {
  if (!iso) return 'تاریخ شمسی پس از انتخاب نمایش داده می‌شود';
  const parts = iso.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}
function quantityLabel(milli) {
  const value = Number(milli || 0) / 1000;
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 }).format(value);
}
async function renderDocuments(type) {
  const rows = await window.marketApp.listDocuments(type);
  const tbody = $(type + '-documents-table');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">هنوز سندی ثبت نشده است. برای شروع، سند جدید بسازید.</td></tr>'; return; }
  tbody.innerHTML = rows.map(doc => {
    const status = doc.status === 'finalized' ? 'قطعی' : doc.status === 'voided' ? 'باطل‌شده' : 'پیش‌نویس';
    const actions = doc.status === 'draft' ? '<button class="small-action" data-edit-document="' + doc.id + '" data-type="' + type + '">ادامه / ثبت</button>' :
      doc.status === 'finalized' ? '<button class="small-action" data-void-document="' + doc.id + '" data-type="' + type + '">ابطال با علت</button>' : '—';
    return '<tr><td><span class="product-code">' + escapeHtml(doc.documentNumber) + '</span></td><td>' + escapeHtml(doc.documentDate) + '<small class="date-jalali">' + escapeHtml(jalaliPreview(doc.documentDate)) + '</small></td><td>' + escapeHtml(doc.partyName || '—') + '</td><td>' + digitsFa(doc.itemCount) + '</td><td>' + formatMoney(doc.totalIrr) + '</td><td><span class="status-pill ' + (doc.status === 'finalized' ? '' : 'inactive') + '">' + status + '</span></td><td>' + actions + '</td></tr>';
  }).join('');
}
async function renderInventory() {
  const rows = await window.marketApp.listInventory();
  $('inventory-table').innerHTML = rows.length ? rows.map(row => {
    const negative = row.quantityMilli < 0;
    return '<tr><td><span class="product-code">' + escapeHtml(row.code) + '</span></td><td class="product-name">' + escapeHtml(row.name) + '</td><td>' + escapeHtml(row.unit) + '</td><td><span class="' + (negative ? 'negative-stock' : '') + '">' + quantityLabel(row.quantityMilli) + (negative ? ' ⚠' : '') + '</span></td><td>' + formatMoney(row.latestPurchasePriceIrr) + '</td><td>' + formatMoney(row.valuationIrr) + '</td></tr>';
  }).join('') : '<tr><td colspan="6" class="empty-cell">برای مشاهدهٔ موجودی، ابتدا کالا و سپس خرید/فروش ثبت کنید.</td></tr>';
}
async function openDocument(type, doc = null) {
  const products = await window.marketApp.listProducts({ activeOnly: true });
  if (!products.length) { toast('ابتدا از بخش کالاها حداقل یک کالای فعال ثبت کنید.', true); return; }
  $('document-form').reset(); $('document-form-error').hidden = true;
  $('document-id').value = doc?.id || ''; $('document-type').value = type;
  $('document-date').value = doc?.documentDate || localIsoDate();
  $('document-party').value = doc?.partyName || ''; $('document-notes').value = doc?.notes || '';
  $('document-dialog-title').textContent = (type === 'purchase' ? 'ثبت خرید' : 'ثبت فروش') + (doc ? ' · پیش‌نویس' : ' جدید');
  $('document-items').replaceChildren();
  if (doc?.items?.length) {
    for (const item of doc.items) addDocumentItem(item, products);
  } else addDocumentItem(null, products);
  updateDocumentTotal();
  $('jalali-date-preview').textContent = jalaliPreview($('document-date').value);
  $('document-dialog').showModal();
}
function addDocumentItem(item = null, products = null) {
  if (!products) products = state.products;
  const type = $('document-type').value;
  const row = document.createElement('div'); row.className = 'document-item-row';
  const options = products.map(p => '<option value="' + p.id + '" data-unit="' + escapeHtml(p.unit) + '" data-purchase="' + (p.purchasePriceIrr ?? '') + '" data-sale="' + p.salePriceIrr + '">' + escapeHtml(p.code + ' · ' + p.name) + '</option>').join('');
  row.innerHTML = '<label class="item-product-label">کالا<select class="item-product" required><option value="">انتخاب کالا…</option>' + options + '</select></label><label class="item-quantity-label">مقدار<input class="item-quantity" type="number" min="0.001" step="0.001" value="1" required inputmode="decimal"></label><label class="item-price-label">قیمت واحد (ریال)<input class="item-price" type="number" min="0" step="1" value="0" required inputmode="numeric"></label><div class="item-sum"><small>جمع قلم</small><strong>۰</strong></div><button class="remove-item" type="button" aria-label="حذف قلم">×</button>';
  $('document-items').append(row);
  const select = row.querySelector('.item-product'), qty = row.querySelector('.item-quantity'), price = row.querySelector('.item-price');
  if (item) { select.value = String(item.productId); qty.value = Number(item.quantityMilli) / 1000; price.value = item.unitPriceIrr; }
  select.addEventListener('change', () => {
    const opt = select.selectedOptions[0];
    if (opt) {
      const unit = opt.dataset.unit || 'عدد';
      qty.step = ['عدد', 'بسته', 'سرویس'].includes(unit) ? '1' : '0.001';
      qty.min = qty.step;
      if (type === 'sale') price.value = opt.dataset.sale || '0';
      else price.value = opt.dataset.purchase || '0';
      if (!item) qty.value = '1';
    }
    updateDocumentTotal();
  });
  qty.addEventListener('input', updateDocumentTotal); price.addEventListener('input', updateDocumentTotal);
  row.querySelector('.remove-item').addEventListener('click', () => { row.remove(); updateDocumentTotal(); });
  if (select.value) select.dispatchEvent(new Event('change'));
}
function updateDocumentTotal() {
  let total = 0;
  document.querySelectorAll('.document-item-row').forEach(row => {
    const qty = Math.round(Number(row.querySelector('.item-quantity').value || 0) * 1000);
    const price = Math.max(0, Math.trunc(Number(row.querySelector('.item-price').value || 0)));
    const sum = Math.round(qty * price / 1000); total += sum;
    row.querySelector('.item-sum strong').textContent = formatMoney(sum);
  });
  $('document-total').textContent = formatMoney(total);
}
function collectDocumentPayload() {
  const items = [...document.querySelectorAll('.document-item-row')].map(row => ({
    productId: row.querySelector('.item-product').value,
    quantityMilli: Math.round(Number(row.querySelector('.item-quantity').value) * 1000),
    unitPriceIrr: row.querySelector('.item-price').value,
    discountType: 'none', discountValue: 0, taxRateBp: 0
  }));
  return { id: $('document-id').value || null, type: $('document-type').value, documentDate: $('document-date').value,
    partyName: $('document-party').value, notes: $('document-notes').value, items };
}
async function submitDocument(finalize) {
  const submit = finalize ? $('finalize-document') : $('save-document-draft');
  submit.disabled = true; $('document-form-error').hidden = true;
  try {
    const saved = await window.marketApp.saveDocumentDraft(collectDocumentPayload());
    if (finalize) {
      const result = await window.marketApp.finalizeDocument(saved.id);
      toast('سند ' + result.documentNumber + ' با موفقیت قطعی شد.');
    } else toast('پیش‌نویس سند ذخیره شد.');
    const type = $('document-type').value; $('document-dialog').close(); await renderDocuments(type); await renderInventory(); await renderDashboard();
  } catch (error) {
    $('document-form-error').textContent = error.message || 'ذخیرهٔ سند ناموفق بود.';
    $('document-form-error').hidden = false;
  } finally { submit.disabled = false; }
}
function openProduct(product = null) {
  $('product-form').reset(); $('product-form-error').hidden = true;
  $('product-id').value = product?.id || ''; $('product-code').value = product?.code || '';
  $('product-name').value = product?.name || ''; $('product-unit').value = product?.unit || 'عدد';
  $('product-purchase-price').value = product?.purchasePriceIrr ?? ''; $('product-sale-price').value = product?.salePriceIrr ?? 0;
  $('product-min-stock').value = product ? Number(product.minStockMilli || 0) / 1000 : 0; $('product-description').value = product?.description || '';
  $('product-dialog-title').textContent = product ? 'ویرایش مشخصات کالا' : 'ثبت کالای جدید';
  fillCategorySelect(product?.categoryId || '').then(() => $('product-dialog').showModal()).catch(e => toast(e.message, true));
}
async function saveProduct(event) {
  event.preventDefault(); const submit = $('save-product'); submit.disabled = true; $('product-form-error').hidden = true;
  try {
    await window.marketApp.saveProduct({
      id: $('product-id').value || null, code: $('product-code').value, name: $('product-name').value,
      categoryId: $('product-category').value || null, unit: $('product-unit').value,
      purchasePriceIrr: $('product-purchase-price').value, salePriceIrr: $('product-sale-price').value,
      minStockMilli: Math.round(Number($('product-min-stock').value) * 1000), description: $('product-description').value
    });
    $('product-dialog').close(); toast('اطلاعات کالا ذخیره شد.'); await renderProducts(); await renderDashboard();
  } catch (error) {
    $('product-form-error').textContent = error.message || 'ذخیرهٔ کالا ناموفق بود.';
    $('product-form-error').hidden = false;
  } finally { submit.disabled = false; }
}
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-page]'); if (nav) { await goTo(nav.dataset.page); return; }
  const go = event.target.closest('[data-go]'); if (go) { await goTo(go.dataset.go); return; }
  const edit = event.target.closest('[data-edit-product]');
  if (edit) { const p = state.products.find(item => item.id === Number(edit.dataset.editProduct)); if (p) openProduct(p); return; }
  const toggle = event.target.closest('[data-toggle-product]');
  if (toggle) {
    try { const active = toggle.dataset.active !== '1'; await window.marketApp.setProductActive(Number(toggle.dataset.toggleProduct), active); toast(active ? 'کالا فعال شد.' : 'کالا غیرفعال شد.'); await renderProducts(); await renderDashboard(); }
    catch (error) { toast(error.message || 'تغییر وضعیت ناموفق بود.', true); } return;
  }
  const newReturn = event.target.closest('#new-return');
  if (newReturn) { try { await openReturnDialog(); } catch(e) { toast(e.message, true); } return; }
  const finishReturn = event.target.closest('[data-finalize-return]');
  if (finishReturn) { try { const r = await window.marketApp.finalizeReturn(Number(finishReturn.dataset.finalizeReturn)); toast('برگشت ' + r.returnNumber + ' قطعی شد.'); await renderReturns(); await renderInventory(); } catch(e) { toast(e.message, true); } return; }
  const csvButton = event.target.closest('[data-export-csv]');
  if (csvButton) { await exportReport(csvButton.dataset.exportCsv, 'csv'); return; }
  const pdfButton = event.target.closest('[data-export-pdf]');
  if (pdfButton) { await exportReport(pdfButton.dataset.exportPdf, 'pdf'); return; }
  const newDoc = event.target.closest('[data-new-document]');
  if (newDoc) { try { await openDocument(newDoc.dataset.newDocument); } catch(e) { toast(e.message, true); } return; }
  const editDoc = event.target.closest('[data-edit-document]');
  if (editDoc) { try { const doc = await window.marketApp.getDocument(Number(editDoc.dataset.editDocument)); await openDocument(editDoc.dataset.type, doc); } catch(e) { toast(e.message, true); } return; }
  const voidDoc = event.target.closest('[data-void-document]');
  if (voidDoc) {
    const reason = window.prompt('علت ابطال این سند را بنویسید:');
    if (reason && reason.trim()) {
      try { await window.marketApp.voidDocument(Number(voidDoc.dataset.voidDocument), reason.trim()); toast('سند با حفظ سابقه باطل شد.'); await renderDocuments(voidDoc.dataset.type); await renderInventory(); await renderDashboard(); }
      catch(e) { toast(e.message || 'ابطال سند ناموفق بود.', true); }
    }
    return;
  }
  const theme = event.target.closest('[data-theme-choice]');
  if (theme) { try { await window.marketApp.setSetting('theme', theme.dataset.themeChoice); applyTheme(theme.dataset.themeChoice); } catch(e) { toast(e.message, true); } return; }
  const money = event.target.closest('[data-money-choice]');
  if (money) { try { await window.marketApp.setSetting('money_display', money.dataset.moneyChoice); applyMoneyDisplay(money.dataset.moneyChoice); if (state.page === 'products') await renderProducts(); } catch(e) { toast(e.message, true); } return; }
});
$('new-product').addEventListener('click', () => openProduct());
$('product-form').addEventListener('submit', saveProduct);
$('close-product-dialog').addEventListener('click', () => $('product-dialog').close());
$('cancel-product').addEventListener('click', () => $('product-dialog').close());
$('product-search').addEventListener('input', () => { if (state.page === 'products') renderProducts().catch(e => toast(e.message, true)); });
$('show-inactive').addEventListener('change', () => renderProducts().catch(e => toast(e.message, true)));
$('category-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await window.marketApp.saveCategory({ name: $('category-name').value }); $('category-name').value = ''; toast('دسته‌بندی ثبت شد.'); await renderCategories(); await fillCategorySelect(); await renderDashboard(); }
  catch(error) { toast(error.message || 'ثبت دسته‌بندی ناموفق بود. احتمالاً نام تکراری است.', true); }
  finally { button.disabled = false; }
});
$('theme-toggle').addEventListener('click', async () => {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  try { await window.marketApp.setSetting('theme', next); applyTheme(next); } catch(e) { toast(e.message, true); }
});

$('document-date').addEventListener('change', () => { $('jalali-date-preview').textContent = jalaliPreview($('document-date').value); });
$('add-document-item').addEventListener('click', async () => {
  try { const products = await window.marketApp.listProducts({ activeOnly: true }); addDocumentItem(null, products); updateDocumentTotal(); }
  catch(e) { toast(e.message, true); }
});
$('save-document-draft').addEventListener('click', () => submitDocument(false));
$('document-form').addEventListener('submit', event => { event.preventDefault(); submitDocument(true); });
$('close-document-dialog').addEventListener('click', () => $('document-dialog').close());
$('cancel-document').addEventListener('click', () => $('document-dialog').close());
$('refresh-inventory').addEventListener('click', () => renderInventory().catch(e => toast(e.message, true)));

$('new-return').addEventListener('click', () => openReturnDialog().catch(e => toast(e.message, true)));
$('return-source').addEventListener('change', () => renderReturnableItems($('return-source').value).catch(e => toast(e.message, true)));
$('return-date').addEventListener('change', () => { $('return-jalali-preview').textContent = jalaliPreview($('return-date').value); });
$('return-form').addEventListener('submit', submitReturn);
$('close-return-dialog').addEventListener('click', () => $('return-dialog').close());
$('cancel-return').addEventListener('click', () => $('return-dialog').close());
$('create-backup').addEventListener('click', async () => {
  const button = $('create-backup'); button.disabled = true;
  try { const result = await window.marketApp.createBackup(); if (!result.canceled) toast('پشتیبان معتبر ذخیره شد: ' + result.filePath); }
  catch(e) { toast(e.message || 'ساخت پشتیبان ناموفق بود.', true); }
  finally { button.disabled = false; }
});
$('restore-backup').addEventListener('click', async () => {
  if (!window.confirm('بازیابی، دادهٔ فعلی برنامه را جایگزین می‌کند. پیش از آن یک نسخهٔ ایمنی ساخته می‌شود. ادامه می‌دهید؟')) return;
  const button = $('restore-backup'); button.disabled = true;
  try { const result = await window.marketApp.restoreBackup(); if (!result.canceled) { toast('بازیابی موفق شد. نسخهٔ ایمنی: ' + result.safetyPath); window.setTimeout(() => window.location.reload(), 900); } }
  catch(e) { toast(e.message || 'بازیابی ناموفق بود.', true); }
  finally { button.disabled = false; }
});
window.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') button.click(); }));
  try {
    const settings = await window.marketApp.getSettings();
    applyTheme(settings.theme || 'system'); applyMoneyDisplay(settings.money_display || 'irr');
    await renderDashboard();
  } catch (error) { $('database-status').textContent = 'خطا'; toast('راه‌اندازی رابط ناموفق بود: ' + (error.message || ''), true); }
});
