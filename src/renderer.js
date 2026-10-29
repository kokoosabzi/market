async function renderStatus() {
  const errorElement = document.getElementById('startup-error');
  try {
    const [appInfo, databaseStatus] = await Promise.all([
      window.marketApp.getAppInfo(), window.marketApp.getDatabaseStatus()
    ]);
    document.getElementById('app-version').textContent = `نسخهٔ ${appInfo.version}`;
    document.getElementById('database-status').textContent = databaseStatus.connected ? 'متصل و آماده' : 'متصل نیست';
    document.getElementById('schema-version').textContent = String(databaseStatus.schemaVersion);
    document.getElementById('database-location').textContent = databaseStatus.location;
  } catch (error) {
    document.getElementById('database-status').textContent = 'خطا در بررسی';
    errorElement.textContent = 'دریافت وضعیت برنامه ناموفق بود. برنامه را ببندید و دوباره اجرا کنید.';
    errorElement.hidden = false;
    console.error('Unable to render Market status:', error);
  }
}
window.addEventListener('DOMContentLoaded', renderStatus);
