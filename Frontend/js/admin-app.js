(function () {
  'use strict';

  const API = (window.BAT_CONFIG?.apiBase || 'http://localhost:3000').replace(/\/$/, '');
  const TOKEN_KEY = 'bat_admin_token';
  const PAGE_SIZE = 50;

  let token    = localStorage.getItem(TOKEN_KEY) || '';
  let curPage  = 1;
  let curTotal = 0;
  let editMap  = null;
  let editMarker = null;
  let editingId  = null;
  let deleteId   = null;
  let mapboxToken = '';

  // ── Auth helpers ──────────────────────────────────────────────────────────

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  async function checkAuth() {
    if (!token) return false;
    try {
      const r = await fetch(`${API}/api/admin/me`, { headers: authHeaders() });
      return r.ok;
    } catch { return false; }
  }

  function showApp(user) {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('admin-app').hidden = false;
    document.getElementById('nav-user').textContent = ' ' + user;
  }

  function showLogin() {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('admin-app').hidden = true;
  }

  async function loadConfig() {
    try {
      const r = await fetch(`${API}/api/admin/config`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        mapboxToken = data.mapboxToken;
      }
    } catch (e) {
      console.warn('Failed to load mapbox token from API:', e);
    }
  }

  // ── Login ──────────────────────────────────────────────────────────────

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');
    const user  = document.getElementById('login-user').value.trim();
    const pass  = document.getElementById('login-pass').value;
    btn.textContent = 'Signing in…'; btn.disabled = true;
    errEl.hidden = true;

    try {
      const r = await fetch(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Login failed');
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      showApp(data.user);
      await loadConfig();
      loadData();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  });

  // ── Data loading ──────────────────────────────────────────────────────────

  async function loadData(page = 1) {
    curPage = page;
    const search   = document.getElementById('search-box').value.trim();
    const status   = document.getElementById('f-status').value;
    const severity = document.getElementById('f-severity').value;

    const qs = new URLSearchParams({ page, limit: PAGE_SIZE });
    if (search)            qs.set('search', search);
    if (status !== 'all')   qs.set('status', status);
    if (severity !== 'all') qs.set('severity', severity);

    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '<tr><td colspan="9" class="t-loading">Loading…</td></tr>';

    try {
      const r = await fetch(`${API}/api/admin/accidents?${qs}`, { headers: authHeaders() });
      if (r.status === 401) { showLogin(); return; }
      const data = await r.json();
      curTotal = data.total;
      renderTable(data.rows);
      renderPagination(data.total, page, PAGE_SIZE);
      document.getElementById('record-count').textContent =
        `${data.total} record${data.total !== 1 ? 's' : ''}`;
      updateStats(data.rows);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" class="t-loading" style="color:#dc2626">Error: ${e.message}</td></tr>`;
    }
  }

  function updateStats(rows) {
    const all = rows;
    document.getElementById('s-total').textContent   = curTotal;
    document.getElementById('s-active').textContent  = all.filter(r => r.status === 'active').length;
    document.getElementById('s-hidden').textContent  = all.filter(r => r.status === 'hidden').length;
    document.getElementById('s-fatal').textContent   = all.filter(r => r.severity === 'fatal').length;
    document.getElementById('s-serious').textContent = all.filter(r => r.severity === 'serious').length;
    document.getElementById('s-minor').textContent   = all.filter(r => r.severity === 'minor').length;
  }

  // ── Render table ──────────────────────────────────────────────────────────

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderTable(rows) {
    const tbody = document.getElementById('table-body');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="t-loading">No records found.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const sevClass = `sev-${r.severity}`;
      const sevLabel = r.severity === 'fatal' ? 'Fatal' : r.severity === 'serious' ? 'Serious' : 'Minor';
      const hasLink  = r.link && r.link !== '#' && /^https?:\/\//i.test(r.link);
      const titleHtml = hasLink
        ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a>`
        : `<span class="no-link">${esc(r.title)}</span>`;
      const coordHtml = r.lat && r.lng
        ? `<span>${parseFloat(r.lat).toFixed(4)}, ${parseFloat(r.lng).toFixed(4)}</span>`
        : `<span class="no-coords">No coords</span>`;
      const stClass = r.status === 'active' ? 'status-active' : 'status-hidden';
      const stLabel = r.status === 'active' ? '● Active' : '○ Hidden';

      return `<tr data-id="${esc(r.id)}">
        <td class="cell-id">${esc(r.id)}</td>
        <td class="cell-title">${titleHtml}</td>
        <td class="cell-source">${esc(r.source || '—')}</td>
        <td class="cell-date">${esc(r.date || '—')}</td>
        <td class="cell-loc">${esc(r.location || r.area || '—')}</td>
        <td><span class="sev-badge ${sevClass}">${sevLabel}</span></td>
        <td class="cell-coords">${coordHtml}</td>
        <td>
          <button class="status-badge ${stClass}" data-action="toggle-status" data-id="${esc(r.id)}" data-status="${esc(r.status)}">
            ${stLabel}
          </button>
        </td>
        <td>
          <div class="action-btns">
            <button class="btn-edit" data-action="edit" data-id="${esc(r.id)}" data-row='${JSON.stringify({id:r.id,title:r.title,link:r.link||'',lat:r.lat||'',lng:r.lng||'',location:r.location||'',area:r.area||''})}'> Edit</button>
            <button class="btn-del"  data-action="delete" data-id="${esc(r.id)}" data-title="${esc(r.title)}"> Delete</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    // Attach click handlers
    tbody.querySelectorAll('[data-action="toggle-status"]').forEach(btn => {
      btn.addEventListener('click', () => toggleStatus(btn.dataset.id, btn.dataset.status));
    });
    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => openEdit(JSON.parse(btn.dataset.row)));
    });
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => openConfirmDelete(btn.dataset.id, btn.dataset.title));
    });
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  function renderPagination(total, page, limit) {
    const pages = Math.ceil(total / limit);
    const el = document.getElementById('pagination');
    if (pages <= 1) { el.innerHTML = ''; return; }

    const btns = [];
    btns.push(`<button class="pg-btn" ${page === 1 ? 'disabled' : ''} data-p="${page-1}">‹ Prev</button>`);
    for (let p = Math.max(1, page-2); p <= Math.min(pages, page+2); p++) {
      btns.push(`<button class="pg-btn ${p===page?'active':''}" data-p="${p}">${p}</button>`);
    }
    btns.push(`<button class="pg-btn" ${page===pages?'disabled':''} data-p="${page+1}">Next ›</button>`);
    el.innerHTML = btns.join('');
    el.querySelectorAll('.pg-btn:not(:disabled)').forEach(b => {
      b.addEventListener('click', () => loadData(parseInt(b.dataset.p)));
    });
  }

  // ── Toggle status ─────────────────────────────────────────────────────────

  async function toggleStatus(id, current) {
    const newStatus = current === 'active' ? 'hidden' : 'active';
    try {
      const r = await fetch(`${API}/api/admin/accidents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      loadData(curPage);
    } catch (e) {
      alert('Failed to update status: ' + e.message);
    }
  }

  // ── Edit modal ────────────────────────────────────────────────────────────

  function openEdit(row) {
    editingId = row.id;
    const modal = document.getElementById('edit-modal');
    document.getElementById('modal-search-place').value = '';

    document.getElementById('modal-info').innerHTML =
      `<strong>${esc(row.title)}</strong><br>
       <span style="font-size:12px;color:#64748b">${esc(row.location || row.area || '—')}</span>`;

    const latVal = parseFloat(row.lat) || 12.9716;
    const lngVal = parseFloat(row.lng) || 77.5946;
    document.getElementById('edit-lat').value = row.lat || '';
    document.getElementById('edit-lng').value = row.lng || '';

    const linkEl = document.getElementById('modal-link');
    const linkOpen = document.getElementById('modal-link-open');
    linkEl.value = row.link || '';
    if (row.link && /^https?:\/\//i.test(row.link)) {
      linkOpen.href = row.link;
      linkOpen.style.opacity = '1';
      linkOpen.style.pointerEvents = 'auto';
    } else {
      linkOpen.href = '#';
      linkOpen.style.opacity = '0.4';
      linkOpen.style.pointerEvents = 'none';
    }

    document.getElementById('modal-error').hidden = true;
    modal.hidden = false;

    // Init or update map
    setTimeout(() => {
      if (!editMap) {
        editMap = L.map('edit-map', { center: [latVal, lngVal], zoom: 13 });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution: ' OSM  CARTO', subdomains: 'abcd', maxZoom: 19,
        }).addTo(editMap);
        editMap.on('click', e => {
          const { lat, lng } = e.latlng;
          document.getElementById('edit-lat').value = lat.toFixed(6);
          document.getElementById('edit-lng').value = lng.toFixed(6);
          if (editMarker) editMap.removeLayer(editMarker);
          editMarker = L.circleMarker([lat, lng], { radius: 8, fillColor: '#dc2626', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(editMap);
        });
      } else {
        editMap.setView([latVal, lngVal], 13);
      }

      if (editMarker) editMap.removeLayer(editMarker);
      if (row.lat && row.lng) {
        editMarker = L.circleMarker([latVal, lngVal], { radius: 8, fillColor: '#dc2626', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(editMap);
      }
      editMap.invalidateSize();
    }, 100);

    // Sync inputs → marker
    ['edit-lat','edit-lng'].forEach(id => {
      document.getElementById(id).oninput = () => {
        const lat = parseFloat(document.getElementById('edit-lat').value);
        const lng = parseFloat(document.getElementById('edit-lng').value);
        if (!isNaN(lat) && !isNaN(lng)) {
          if (editMarker) editMap.removeLayer(editMarker);
          editMarker = L.circleMarker([lat, lng], { radius: 8, fillColor: '#dc2626', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(editMap);
          editMap.setView([lat, lng]);
        }
      };
    });
  }

  function closeEdit() {
    document.getElementById('edit-modal').hidden = true;
    editingId = null;
  }

  async function searchPlaceOnMap() {
    const searchVal = document.getElementById('modal-search-place').value.trim();
    const errEl = document.getElementById('modal-error');
    const searchBtn = document.getElementById('modal-search-btn');
    errEl.hidden = true;

    if (!searchVal) return;

    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching…';

    try {
      let lat = null, lng = null, displayName = '';

      if (mapboxToken) {
        // Mapbox Places API — bbox limits results to Bangalore metropolitan area
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchVal)}.json?access_token=${mapboxToken}&bbox=77.35,12.7,77.85,13.25&limit=1`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`);
        const data = await res.json();
        if (data && data.features && data.features.length > 0) {
          const feat = data.features[0];
          lng = feat.center[0];
          lat = feat.center[1];
          displayName = feat.place_name;
        }
      } else {
        // Nominatim (OSM) fallback query
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchVal + ', Bengaluru, Karnataka, India')}&format=json&limit=1`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
        const data = await res.json();
        if (data && data.length > 0) {
          lat = parseFloat(data[0].lat);
          lng = parseFloat(data[0].lon);
          displayName = data[0].display_name;
        } else {
          // Nominatim fallback with Karnataka
          const fallbackUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchVal + ', Karnataka, India')}&format=json&limit=1`;
          const resFallback = await fetch(fallbackUrl);
          if (!resFallback.ok) throw new Error(`Nominatim Fallback HTTP ${resFallback.status}`);
          const dataFallback = await resFallback.json();
          if (dataFallback && dataFallback.length > 0) {
            lat = parseFloat(dataFallback[0].lat);
            lng = parseFloat(dataFallback[0].lon);
            displayName = dataFallback[0].display_name;
          }
        }
      }

      if (lat !== null && lng !== null) {
        document.getElementById('edit-lat').value = lat.toFixed(6);
        document.getElementById('edit-lng').value = lng.toFixed(6);

        if (editMap) {
          if (editMarker) editMap.removeLayer(editMarker);
          editMarker = L.circleMarker([lat, lng], { radius: 8, fillColor: '#dc2626', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(editMap);
          editMap.setView([lat, lng], 14);
        }
        console.log(`Geocoded "${searchVal}" to: (${lat}, ${lng}) - ${displayName}`);
      } else {
        errEl.textContent = 'Location not found. Please try a different name or set coordinates manually.';
        errEl.hidden = false;
      }
    } catch (e) {
      errEl.textContent = 'Search failed: ' + e.message;
      errEl.hidden = false;
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Search';
    }
  }

  document.getElementById('modal-search-btn').addEventListener('click', searchPlaceOnMap);
  document.getElementById('modal-search-place').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchPlaceOnMap();
    }
  });

  document.getElementById('modal-close').addEventListener('click', closeEdit);
  document.getElementById('modal-cancel').addEventListener('click', closeEdit);

  document.getElementById('modal-save').addEventListener('click', async () => {
    const lat = parseFloat(document.getElementById('edit-lat').value);
    const lng = parseFloat(document.getElementById('edit-lng').value);
    const errEl = document.getElementById('modal-error');
    errEl.hidden = true;

    if (isNaN(lat) || isNaN(lng)) {
      errEl.textContent = 'Please enter valid latitude and longitude, or click on the map.';
      errEl.hidden = false; return;
    }
    if (lat < 12.5 || lat > 13.5 || lng < 77.0 || lng > 78.2) {
      errEl.textContent = `Warning: (${lat.toFixed(4)}, ${lng.toFixed(4)}) is outside the Bangalore region. Continue saving anyway?`;
      errEl.hidden = false;
      // allow save anyway on second click
    }

    try {
      const r = await fetch(`${API}/api/admin/accidents/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ lat, lng }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      closeEdit();
      loadData(curPage);
    } catch (e) {
      errEl.textContent = 'Save failed: ' + e.message;
      errEl.hidden = false;
    }
  });

  // ── Delete modal ──────────────────────────────────────────────────────────

  function openConfirmDelete(id, title) {
    deleteId = id;
    document.getElementById('confirm-text').innerHTML =
      `This will <strong>permanently delete</strong> the following record from PostgreSQL. This cannot be undone.<br><br>
       <em style="color:#dc2626">"${esc(title)}"</em>`;
    document.getElementById('confirm-modal').hidden = false;
  }

  function closeConfirmDelete() {
    document.getElementById('confirm-modal').hidden = true;
    deleteId = null;
  }

  document.getElementById('confirm-close').addEventListener('click', closeConfirmDelete);
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirmDelete);

  document.getElementById('confirm-ok').addEventListener('click', async () => {
    try {
      const r = await fetch(`${API}/api/admin/accidents/${encodeURIComponent(deleteId)}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      closeConfirmDelete();
      loadData(curPage);
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  });

  // Close modals on backdrop click
  document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEdit(); });
  document.getElementById('confirm-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirmDelete(); });

  // ── Add Article modal ────────────────────────────────────────────────────
  const addModal = document.getElementById('add-modal');
  const uploadBtn = document.getElementById('upload-btn');

  uploadBtn.addEventListener('click', () => {
    document.getElementById('add-title').value = '';
    document.getElementById('add-source').value = '';
    document.getElementById('add-link').value = '';
    document.getElementById('add-content').value = '';
    document.getElementById('add-modal-error').hidden = true;
    addModal.hidden = false;
  });

  function closeAddModal() {
    addModal.hidden = true;
  }

  document.getElementById('add-modal-close').addEventListener('click', closeAddModal);
  document.getElementById('add-modal-cancel').addEventListener('click', closeAddModal);

  document.getElementById('add-modal-save').addEventListener('click', async () => {
    const title = document.getElementById('add-title').value.trim();
    const source = document.getElementById('add-source').value.trim();
    const link = document.getElementById('add-link').value.trim();
    const content = document.getElementById('add-content').value.trim();
    const errEl = document.getElementById('add-modal-error');
    const saveBtn = document.getElementById('add-modal-save');
    errEl.hidden = true;

    if (!link && (!title || !content)) {
      errEl.textContent = 'Please provide either an Article Link, or Title and Content manually.';
      errEl.hidden = false;
      return;
    }

    if (link && !/^https?:\/\/\S+/i.test(link)) {
      errEl.textContent = 'Please enter a valid URL starting with http:// or https://';
      errEl.hidden = false;
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = link ? 'Scraping & Verifying…' : 'Verifying with DeepSeek…';

    try {
      const r = await fetch(`${API}/api/admin/accidents`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title, source, link, content }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Verification failed');
      closeAddModal();
      loadData(1);
    } catch (e) {
      errEl.textContent = 'Upload failed: ' + e.message;
      errEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Verify & Upload';
    }
  });

  document.getElementById('add-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddModal(); });

  // ── Filters ───────────────────────────────────────────────────────────────

  document.getElementById('apply-btn').addEventListener('click', () => loadData(1));
  document.getElementById('search-box').addEventListener('keydown', e => { if (e.key === 'Enter') loadData(1); });

  // ── Boot ──────────────────────────────────────────────────────────────────

  async function boot() {
    if (token && await checkAuth()) {
      showApp(ADMIN_USER || 'admin');
      await loadConfig();
      loadData();
    } else {
      token = '';
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
    }
  }

  const ADMIN_USER = 'admin'; // display only
  boot();
})();
