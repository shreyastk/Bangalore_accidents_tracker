(function () {
  const KEY = 'bat_offline_report_queue_v1';
  function list() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
  function save(items) { localStorage.setItem(KEY, JSON.stringify(items)); }
  function queue(report) { const items = list(); items.push({ report, queuedAt: new Date().toISOString() }); save(items); return items.length; }
  async function flush() {
    if (!navigator.onLine || !window.SupabaseAuthClient) return;
    const session = await window.SupabaseAuthClient.getSession();
    if (!session?.access_token) return;
    const api = (window.BAT_CONFIG?.apiBase || '').replace(/\/$/, '');
    const remaining = [];
    for (const item of list()) {
      try {
        const response = await fetch(`${api}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(item.report) });
        if (!response.ok) remaining.push(item);
      } catch (_) { remaining.push(item); }
    }
    save(remaining);
    if (!remaining.length && document.body) window.dispatchEvent(new CustomEvent('bat:offline-reports-synced'));
  }
  window.OfflineReports = { queue, flush, count: () => list().length };
  window.addEventListener('online', flush);
  window.addEventListener('load', flush);
})();
