const $ = (id) => document.getElementById(id);
const state = { page: 'dashboard', theme: 'system', moneyDisplay: 'irr', products: [], categories: [] };
const pageTitles = { dashboard: 'نمای کلی', products: 'مدیریت کالاها', categories: 'دسته‌بندی‌ها', settings: 'تنظیمات' };
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
window.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') button.click(); }));
  try {
    const settings = await window.marketApp.getSettings();
    applyTheme(settings.theme || 'system'); applyMoneyDisplay(settings.money_display || 'irr');
    await renderDashboard();
  } catch (error) { $('database-status').textContent = 'خطا'; toast('راه‌اندازی رابط ناموفق بود: ' + (error.message || ''), true); }
});
