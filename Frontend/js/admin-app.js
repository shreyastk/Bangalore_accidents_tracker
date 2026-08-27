(function () {
  'use strict';

  const API = (window.BAT_CONFIG?.apiBase || 'http://localhost:3000').replace(/\/$/, '');
  const TOKEN_KEY = 'bat_admin_token';
  const PAGE_SIZE = 50;

  let token    = sessionStorage.getItem(TOKEN_KEY) || '';
  let curPage  = 1;
  let curTotal = 0;
  let editMap  = null;
  let editMarker = null;
  let editingId  = null;
  let deleteId   = null;
  let mapboxToken = '';

  // ── Toast notification system ─────────────────────────────────────────────

  /**
   * Show a toast notification.
   * @param {string} message - The message to display
   * @param {'success'|'error'|'warning'} type - Toast type (default: 'success')
   * @param {number} duration - Auto-dismiss duration in ms (default: 3000)
   */
  function toast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', 'alert');

    const icons = { success: '✓', error: '✕', warning: '⚠' };
    el.innerHTML = `<span class="toast-icon">${icons[type] || icons.success}</span><span class="toast-msg">${message}</span>`;

    container.appendChild(el);

    // Trigger slide-in animation
    requestAnimationFrame(() => { el.classList.add('toast--visible'); });

    // Auto-dismiss
    const timer = setTimeout(() => dismissToast(el), duration);

    // Allow manual dismiss on click
    el.addEventListener('click', () => {
      clearTimeout(timer);
      dismissToast(el);
    });
  }

  function dismissToast(el) {
    el.classList.add('toast--dismissing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Fallback removal if animationend doesn't fire
    setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
  }

  // ── Auth helpers ──────────────────────────────────────────────────────────

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  /**
   * Attempt to refresh the Supabase JWT token.
   * @returns {boolean} true if refresh succeeded and token was updated
   */
  async function refreshToken() {
    const authClient = window.SupabaseAuthClient;
    if (!authClient) return false;
    try {
      const session = await authClient.getSession();
      if (session && session.access_token) {
        token = session.access_token;
        sessionStorage.setItem(TOKEN_KEY, token);
        return true;
      }
    } catch (e) {
      console.warn('[admin-app] Token refresh failed:', e);
    }
    return false;
  }

  /**
   * Authenticated fetch wrapper that handles 401 responses.
   * On 401: attempts token refresh, retries once with new token.
   * If refresh fails, redirects to admin login.
   *
   * @param {string} url - The URL to fetch
   * @param {object} options - Fetch options (method, body, etc.). Headers are auto-set.
   * @returns {Response} The fetch response
   * @throws {Error} If the fetch fails for non-auth reasons
   *
   * Requirements: 5.4, 5.5
   */
  async function authenticatedFetch(url, options = {}) {
    // Merge auth headers with any additional headers
    options.headers = { ...authHeaders(), ...(options.headers || {}) };

    const r = await fetch(url, options);

    if (r.status === 401) {
      // Attempt token refresh (Req 5.5)
      const refreshed = await refreshToken();
      if (refreshed) {
        // Retry request with refreshed token (overwrite Authorization)
        options.headers = { ...(options.headers || {}), ...authHeaders() };
        return fetch(url, options);
      } else {
        // Refresh failed — redirect to admin login (Req 5.5)
        token = '';
        sessionStorage.removeItem(TOKEN_KEY);
        showLogin();
        // Return original 401 response so callers can handle gracefully
        return r;
      }
    }

    return r;
  }

  async function checkAuth() {
    if (!token) return false;
    try {
      const r = await fetch(`${API}/api/admin/me`, { headers: authHeaders() });
      return r.ok;
    } catch { return false; }
  }

  /**
   * Check if user has admin role by inspecting app_metadata or user_metadata.
   * @param {object} user - Supabase user object
   * @returns {boolean}
   */
  function hasAdminRole(user) {
    if (!user) return false;
    // Check app_metadata.role first (preferred, set via Supabase admin API)
    if (user.app_metadata && user.app_metadata.role === 'admin') return true;
    // Fallback: check user_metadata.role
    if (user.user_metadata && user.user_metadata.role === 'admin') return true;
    return false;
  }

  /**
   * Get display name for the admin user (email or display name from metadata).
   * @param {object} user - Supabase user object
   * @returns {string}
   */
  function getAdminDisplayName(user) {
    if (!user) return 'Admin';
    if (user.user_metadata && user.user_metadata.name) return user.user_metadata.name;
    return user.email || 'Admin';
  }

  // ── Inactivity Timer State ───────────────────────────────────────────────
  let inactivityTimer = null;

  function showApp(user) {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('admin-app').hidden = false;
    document.getElementById('nav-user').textContent = ' ' + user;
    inactivityTimer = initInactivityTimer();
  }

  function showLogin() {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('admin-app').hidden = true;
    if (inactivityTimer) {
      inactivityTimer.stop();
      inactivityTimer = null;
    }
  }

  async function loadConfig() {
    try {
      const r = await authenticatedFetch(`${API}/api/admin/config`);
      if (r.ok) {
        const data = await r.json();
        mapboxToken = data.mapboxToken;
      }
    } catch (e) {
      console.warn('Failed to load mapbox token from API:', e);
    }
  }

  // ── Login (Supabase Auth with role checking) ──────────────────────────────

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-pass').value;
    btn.textContent = 'Signing in…'; btn.disabled = true;
    errEl.hidden = true;

    try {
      // Wait for SupabaseAuthClient to be available (loaded via module script)
      const authClient = window.SupabaseAuthClient;
      if (!authClient) {
        throw new Error('Authentication service is not available. Please refresh the page.');
      }

      // Authenticate via Supabase Auth signInWithPassword (Req 5.1)
      const result = await authClient.signIn(email, pass);
      if (!result.success) {
        throw new Error(result.error || 'Login failed');
      }

      const user = result.user;

      // Check admin role in app_metadata or user_metadata (Req 5.2)
      if (!hasAdminRole(user)) {
        // Not an admin: display error, sign out, redirect within 3 seconds (Req 5.3)
        errEl.textContent = 'Access denied. You are not authorized as an administrator.';
        errEl.hidden = false;
        await authClient.signOut();
        setTimeout(() => {
          showLogin();
        }, 3000);
        return;
      }

      // Admin role confirmed — store Supabase JWT as token (Req 5.4)
      token = result.session.access_token;
      sessionStorage.setItem(TOKEN_KEY, token);

      // Display admin identifier (Req 5.5)
      const displayName = getAdminDisplayName(user);
      showApp(displayName);
      await loadConfig();
      loadData();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    // Sign out via Supabase Auth (Req 5.6)
    const authClient = window.SupabaseAuthClient;
    if (authClient) {
      await authClient.signOut();
    }
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
  });

  // ── Data loading ──────────────────────────────────────────────────────────

  async function loadData(page = 1) {
    curPage = page;
    const search   = document.getElementById('search-box').value.trim();
    const status   = document.getElementById('f-status').value;
    const severity = document.getElementById('f-severity').value;
    const sortVal  = document.getElementById('f-sort').value;

    let sortBy = 'accident_date';
    let sortOrder = 'desc';
    if (sortVal === 'date-asc') {
      sortBy = 'accident_date';
      sortOrder = 'asc';
    } else if (sortVal === 'id-desc') {
      sortBy = 'id';
      sortOrder = 'desc';
    } else if (sortVal === 'id-asc') {
      sortBy = 'id';
      sortOrder = 'asc';
    }

    const isIdSort = sortBy === 'id';
    const limit = isIdSort ? 10000 : PAGE_SIZE;

    const qs = new URLSearchParams({ page: isIdSort ? 1 : page, limit });
    if (search)            qs.set('search', search);
    if (status !== 'all')   qs.set('status', status);
    if (severity !== 'all') qs.set('severity', severity);
    qs.set('sortBy', sortBy);
    qs.set('sortOrder', sortOrder);

    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '<tr><td colspan="9" class="t-loading">Loading…</td></tr>';

    try {
      const r = await authenticatedFetch(`${API}/api/admin/accidents?${qs}`);
      if (r.status === 401) return; // Already handled by authenticatedFetch (redirect to login)
      const data = await r.json();
      curTotal = data.total;
      renderTable(data.rows);
      renderPagination(data.total, isIdSort ? 1 : page, limit);
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

  function updateRowInTable(id, lat, lng, location, area) {
    const rowEl = document.querySelector(`tr[data-id="${id}"]`);
    if (!rowEl) return;

    const coordCell = rowEl.querySelector('.cell-coords');
    if (coordCell) {
      if (lat && lng) {
        coordCell.innerHTML = `<span>${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}</span>`;
      } else {
        coordCell.innerHTML = `<span class="no-coords">No coords</span>`;
      }
    }

    const locCell = rowEl.querySelector('.cell-loc');
    if (locCell) {
      locCell.textContent = location || area || '—';
    }

    const editBtn = rowEl.querySelector('[data-action="edit"]');
    if (editBtn && editBtn.dataset.row) {
      try {
        const rowData = JSON.parse(editBtn.dataset.row);
        rowData.lat = lat || '';
        rowData.lng = lng || '';
        rowData.location = location || '';
        rowData.area = area || '';
        editBtn.dataset.row = JSON.stringify(rowData);
      } catch (e) {
        console.error('Failed to update edit button row dataset', e);
      }
    }
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
      // Checkbox cell for bulk actions
      const checkboxCell = `<td><input type="checkbox" class="row-select" data-id="${esc(r.id)}" aria-label="Select ${esc(r.id)}"></td>`;

      // Approve/Reject buttons for pending user reports
      let pendingBtns = '';
      if (r.status === 'pending' && r.reporter_id) {
        pendingBtns = `
          <button class="btn-approve" data-action="approve" data-id="${esc(r.id)}">Approve</button>
          <button class="btn-reject" data-action="reject" data-id="${esc(r.id)}">Reject</button>
        `;
      }

      const rejectionNote = r.rejection_reason ? `<div style="font-size:12px;color:#b91c1c;margin-top:6px">Reason: ${esc(r.rejection_reason)}</div>` : '';
      const proofLink = r.proof_url
        ? `<a href="${esc(r.proof_url)}" target="_blank" rel="noopener" style="display:block;margin-top:6px">View proof image</a>`
        : '';

      return `<tr data-id="${esc(r.id)}">
        ${checkboxCell}
        <td class="cell-id">${esc(r.id)}</td>
        <td class="cell-title">${titleHtml}</td>
        <td class="cell-source">${esc(r.source || '—')}</td>
        <td class="cell-date">${esc(r.date || '—')}</td>
        <td class="cell-loc">${esc(r.location || r.area || '—')}${proofLink}</td>
        <td><span class="sev-badge ${sevClass}">${sevLabel}</span></td>
        <td class="cell-coords">${coordHtml}</td>
        <td>
          <button class="status-badge ${stClass}" data-action="toggle-status" data-id="${esc(r.id)}" data-status="${esc(r.status)}">
            ${stLabel}
          </button>
          ${rejectionNote}
        </td>
        <td>
          <div class="action-btns">
            <button class="btn-edit" data-action="edit" data-id="${esc(r.id)}" data-row='${JSON.stringify({id:r.id,title:r.title,link:r.link||'',lat:r.lat||'',lng:r.lng||'',location:r.location||'',area:r.area||''})}'> Edit</button>
            <button class="btn-del"  data-action="delete" data-id="${esc(r.id)}" data-title="${esc(r.title)}"> Delete</button>
            ${pendingBtns}
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
    // Approve / Reject single items
    tbody.querySelectorAll('[data-action="approve"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          const r = await authenticatedFetch(`${API}/api/admin/accidents/bulk`, { method: 'POST', body: JSON.stringify({ ids: [id], action: 'verify' }) });
          if (!r.ok) throw new Error((await r.json()).error || 'Failed');
          toast('Approved', 'success');
          loadData(curPage);
        } catch (e) { toast('Approve failed: ' + e.message, 'error'); }
      });
    });
    tbody.querySelectorAll('[data-action="reject"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        // open reject modal for single id
        openRejectModal([id]);
      });
    });
    // Row selection handlers
    tbody.querySelectorAll('.row-select').forEach(cb => { cb.addEventListener('change', () => {}); });
    // Reset header select-all checkbox when table is refreshed
    const selAll = document.getElementById('select-all'); if (selAll) selAll.checked = false;
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
      const r = await authenticatedFetch(`${API}/api/admin/accidents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      if (r.status === 401) return; // Handled by authenticatedFetch
      if (!r.ok) throw new Error((await r.json()).error);
      loadData(curPage);
    } catch (e) {
      toast('Failed to update status: ' + e.message, 'error');
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
    document.getElementById('edit-location').value = row.location || '';
    document.getElementById('edit-area').value = row.area || '';

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
        editMap = new maplibregl.Map({
          container: 'edit-map',
          style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
          center: [lngVal, latVal],
          zoom: 13,
        });

        editMap.addControl(new maplibregl.NavigationControl(), 'top-right');

        editMarker = new maplibregl.Marker({ color: '#dc2626', draggable: true })
          .setLngLat([lngVal, latVal])
          .addTo(editMap);

        // Click map to reposition marker and update inputs
        editMap.on('click', e => {
          const { lng, lat } = e.lngLat;
          document.getElementById('edit-lat').value = lat.toFixed(6);
          document.getElementById('edit-lng').value = lng.toFixed(6);
          editMarker.setLngLat([lng, lat]);
        });

        // Drag marker to update inputs
        editMarker.on('dragend', () => {
          const { lng, lat } = editMarker.getLngLat();
          document.getElementById('edit-lat').value = lat.toFixed(6);
          document.getElementById('edit-lng').value = lng.toFixed(6);
        });
      } else {
        editMap.setCenter([lngVal, latVal]);
        editMarker.setLngLat([lngVal, latVal]);
      }

      setTimeout(() => editMap.resize(), 100);
    }, 100);

    // Sync inputs → marker
    ['edit-lat','edit-lng'].forEach(id => {
        document.getElementById(id).oninput = () => {
          const lat = parseFloat(document.getElementById('edit-lat').value);
          const lng = parseFloat(document.getElementById('edit-lng').value);
          if (!isNaN(lat) && !isNaN(lng)) {
            if (editMarker) editMarker.setLngLat([lng, lat]);
            if (editMap) editMap.setCenter([lng, lat]);
            // Debounced duplicate check when coordinates change
            scheduleDuplicateCheck(lat, lng);
          }
        };
    });
    // Initial duplicate check for this record (use record id)
    checkDuplicates(editingId);
  }

  function closeEdit() {
    document.getElementById('edit-modal').hidden = true;
    editingId = null;
  }

  // ── Duplicate detection helpers ─────────────────────────────────────────
  let dupTimer = null;
  function scheduleDuplicateCheck(lat, lng) {
    if (dupTimer) clearTimeout(dupTimer);
    dupTimer = setTimeout(() => checkDuplicates(editingId, lat, lng), 450);
  }

  async function checkDuplicates(id, lat = null, lng = null) {
    const el = document.getElementById('modal-duplicates');
    if (!el) return;
    el.textContent = 'Checking for nearby records…';
    try {
      const qs = new URLSearchParams();
      if (lat !== null && lng !== null) {
        qs.set('lat', String(lat)); qs.set('lng', String(lng));
      }
      const url = `${API}/api/admin/accidents/${encodeURIComponent(id)}/duplicates${qs.toString() ? ('?' + qs.toString()) : ''}`;
      const r = await authenticatedFetch(url);
      if (r.status === 401) return;
      const data = await r.json();
      if (!data || !data.length) {
        el.innerHTML = '<span style="color:var(--text-muted)">No nearby duplicates found.</span>';
        return;
      }
      // Render small list
      el.innerHTML = data.map(d => {
        const dist = d.distance_m ? (Number(d.distance_m).toFixed(0) + 'm') : '';
        return `<div style="padding:6px 0;border-bottom:1px solid rgba(15,23,42,0.04)"><strong>${esc(d.title || d.location || d.id)}</strong> <span style="color:#64748b;font-size:12px">${esc(d.accident_date||'')} • ${dist}</span><br><a href="#" data-id="${esc(d.id)}" class="dup-open">Open</a></div>`;
      }).join('');
      // Attach handlers to open duplicates in editor
      el.querySelectorAll('.dup-open').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          const rid = a.dataset.id;
          // find row in table and trigger edit if present
          const rowBtn = document.querySelector(`#table-body [data-action="edit"][data-id="${rid}"]`);
          if (rowBtn) { rowBtn.click(); }
          else { toast('Duplicate not currently loaded in table. Refresh table to edit it.', 'warning'); }
        });
      });
    } catch (e) {
      el.innerHTML = `<span style="color:#dc2626">Duplicate check failed: ${e.message}</span>`;
    }
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
          if (editMarker) editMarker.setLngLat([lng, lat]);
          editMap.setCenter([lng, lat]);
          editMap.setZoom(14);
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
    const location = document.getElementById('edit-location').value.trim();
    const area = document.getElementById('edit-area').value.trim();
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
      const r = await authenticatedFetch(`${API}/api/admin/accidents/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ lat, lng, location, area }),
      });
      if (r.status === 401) return; // Handled by authenticatedFetch
      if (!r.ok) throw new Error((await r.json()).error);
      closeEdit();
      updateRowInTable(editingId, lat, lng, location, area);
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
      const r = await authenticatedFetch(`${API}/api/admin/accidents/${encodeURIComponent(deleteId)}`, {
        method: 'DELETE',
      });
      if (r.status === 401) return; // Handled by authenticatedFetch
      if (!r.ok) throw new Error((await r.json()).error);
      closeConfirmDelete();
      loadData(curPage);
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error');
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
      const r = await authenticatedFetch(`${API}/api/admin/accidents`, {
        method: 'POST',
        body: JSON.stringify({ title, source, link, content }),
      });
      if (r.status === 401) return; // Handled by authenticatedFetch
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
  document.getElementById('f-sort').addEventListener('change', () => loadData(1));

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────────

  /** Track the currently highlighted table row index for arrow key navigation */
  let highlightedRowIndex = -1;

  /**
   * Check if the user is currently typing in an input, textarea, or contenteditable element.
   * @param {Event} e - The keyboard event
   * @returns {boolean} true if the user is typing in a text field
   */
  function isTypingInField(e) {
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (e.target.isContentEditable) return true;
    return false;
  }

  /**
   * Get all visible table rows in the data table body.
   * @returns {NodeListOf<HTMLTableRowElement>}
   */
  function getTableRows() {
    return document.querySelectorAll('#table-body tr[data-id]');
  }

  /**
   * Highlight a table row by index, removing highlight from others.
   * @param {number} index - The row index to highlight
   */
  function highlightRow(index) {
    const rows = getTableRows();
    if (!rows.length) return;

    // Remove previous highlight
    rows.forEach(row => row.classList.remove('kb-highlighted'));

    // Clamp index to valid range
    if (index < 0) index = 0;
    if (index >= rows.length) index = rows.length - 1;

    highlightedRowIndex = index;
    const row = rows[highlightedRowIndex];
    row.classList.add('kb-highlighted');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /**
   * Check if any modal is currently visible.
   * @returns {boolean}
   */
  function isAnyModalOpen() {
    const editModal = document.getElementById('edit-modal');
    const confirmModal = document.getElementById('confirm-modal');
    const addModalEl = document.getElementById('add-modal');
    return !editModal.hidden || !confirmModal.hidden || !addModalEl.hidden;
  }

  /**
   * Initialize global keyboard shortcut listener.
   * - Ctrl+S: Save in edit modal
   * - Esc: Close any open modal
   * - Arrow Up/Down: Navigate table rows (when not typing)
   * - Enter: Open edit for highlighted row (when not typing and no modal open)
   */
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+S (or Cmd+S on Mac): Save in edit modal
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const editModal = document.getElementById('edit-modal');
        if (!editModal.hidden) {
          e.preventDefault();
          document.getElementById('modal-save').click();
          return;
        }
        // Also handle add modal save
        const addModalEl = document.getElementById('add-modal');
        if (!addModalEl.hidden) {
          e.preventDefault();
          document.getElementById('add-modal-save').click();
          return;
        }
      }

      // Escape: Close any open modal
      if (e.key === 'Escape') {
        const editModal = document.getElementById('edit-modal');
        const confirmModal = document.getElementById('confirm-modal');
        const addModalEl = document.getElementById('add-modal');

        if (!editModal.hidden) {
          closeEdit();
          return;
        }
        if (!confirmModal.hidden) {
          closeConfirmDelete();
          return;
        }
        if (!addModalEl.hidden) {
          closeAddModal();
          return;
        }
      }

      // Arrow keys: Navigate table rows (only when not typing in a field and no modal open)
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isTypingInField(e) && !isAnyModalOpen()) {
        const rows = getTableRows();
        if (!rows.length) return;

        e.preventDefault();

        if (e.key === 'ArrowDown') {
          highlightRow(highlightedRowIndex + 1);
        } else if (e.key === 'ArrowUp') {
          highlightRow(highlightedRowIndex - 1);
        }
      }

      // Enter: Open edit for highlighted row (when not typing and no modal open)
      if (e.key === 'Enter' && !isTypingInField(e) && !isAnyModalOpen()) {
        const rows = getTableRows();
        if (highlightedRowIndex >= 0 && highlightedRowIndex < rows.length) {
          const row = rows[highlightedRowIndex];
          const editBtn = row.querySelector('[data-action="edit"]');
          if (editBtn) {
            e.preventDefault();
            editBtn.click();
          }
        }
      }
    });
  }

  /**
   * Add keyboard shortcut hint tooltips to relevant buttons.
   */
  function addShortcutHints() {
    // Save button in edit modal
    const modalSave = document.getElementById('modal-save');
    if (modalSave) {
      modalSave.title = 'Save Coordinates (Ctrl+S)';
    }

    // Cancel/Close buttons in edit modal
    const modalClose = document.getElementById('modal-close');
    if (modalClose) {
      modalClose.title = 'Close (Esc)';
    }
    const modalCancel = document.getElementById('modal-cancel');
    if (modalCancel) {
      modalCancel.title = 'Cancel (Esc)';
    }

    // Confirm modal close/cancel
    const confirmClose = document.getElementById('confirm-close');
    if (confirmClose) {
      confirmClose.title = 'Close (Esc)';
    }
    const confirmCancel = document.getElementById('confirm-cancel');
    if (confirmCancel) {
      confirmCancel.title = 'Cancel (Esc)';
    }

    // Add modal save
    const addModalSave = document.getElementById('add-modal-save');
    if (addModalSave) {
      addModalSave.title = 'Verify & Upload (Ctrl+S)';
    }
    const addModalClose = document.getElementById('add-modal-close');
    if (addModalClose) {
      addModalClose.title = 'Close (Esc)';
    }
    const addModalCancel = document.getElementById('add-modal-cancel');
    if (addModalCancel) {
      addModalCancel.title = 'Cancel (Esc)';
    }
  }

  // Initialize keyboard shortcuts and hints
  initKeyboardShortcuts();
  addShortcutHints();

  // ── Bulk selection & actions ──────────────────────────────────────────
  function getSelectedIds() {
    return Array.from(document.querySelectorAll('.row-select:checked')).map(cb => cb.dataset.id);
  }

  function openRejectModal(ids) {
    if (!ids || !ids.length) return toast('No records selected', 'warning');
    // store ids on modal element
    const modal = document.getElementById('reject-modal');
    modal.dataset.ids = JSON.stringify(ids);
    document.getElementById('bulk-reject-reason').value = '';
    modal.hidden = false;
  }

  function closeRejectModal() {
    const modal = document.getElementById('reject-modal');
    modal.hidden = true;
    delete modal.dataset.ids;
  }

  // select-all checkbox handler
  const selectAllEl = document.getElementById('select-all');
  if (selectAllEl) {
    selectAllEl.addEventListener('change', () => {
      const checked = selectAllEl.checked;
      document.querySelectorAll('.row-select').forEach(cb => { cb.checked = checked; });
    });
  }

  // Bulk action buttons
  document.getElementById('approve-selected')?.addEventListener('click', async () => {
    const ids = getSelectedIds(); if (!ids.length) return toast('No records selected', 'warning');
    try {
      const r = await authenticatedFetch(`${API}/api/admin/accidents/bulk`, { method: 'POST', body: JSON.stringify({ ids, action: 'verify' }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      toast('Approved selected', 'success'); loadData(curPage);
    } catch (e) { toast('Bulk approve failed: ' + e.message, 'error'); }
  });

  document.getElementById('reject-selected')?.addEventListener('click', () => {
    const ids = getSelectedIds(); if (!ids.length) return toast('No records selected', 'warning');
    openRejectModal(ids);
  });

  document.getElementById('delete-selected')?.addEventListener('click', async () => {
    const ids = getSelectedIds(); if (!ids.length) return toast('No records selected', 'warning');
    if (!confirm(`Delete ${ids.length} records permanently? This cannot be undone.`)) return;
    try {
      const r = await authenticatedFetch(`${API}/api/admin/accidents/bulk`, { method: 'POST', body: JSON.stringify({ ids, action: 'delete' }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      toast('Deleted selected', 'success'); loadData(curPage);
    } catch (e) { toast('Bulk delete failed: ' + e.message, 'error'); }
  });

  // Reject modal buttons
  document.getElementById('reject-close')?.addEventListener('click', closeRejectModal);
  document.getElementById('reject-cancel')?.addEventListener('click', closeRejectModal);
  document.getElementById('reject-confirm')?.addEventListener('click', async () => {
    const modal = document.getElementById('reject-modal');
    const ids = JSON.parse(modal.dataset.ids || '[]');
    const reason = document.getElementById('bulk-reject-reason').value.trim();
    if (!ids.length) { closeRejectModal(); return; }
    try {
      const r = await authenticatedFetch(`${API}/api/admin/accidents/bulk`, { method: 'POST', body: JSON.stringify({ ids, action: 'hide', rejection_reason: reason }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      toast('Rejected selected', 'success');
      closeRejectModal();
      loadData(curPage);
    } catch (e) { toast('Bulk reject failed: ' + e.message, 'error'); }
  });

  // ── Toast Notification System ────────────────────────────────────────────

  function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast--removing');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Auto-Save Draft to SessionStorage ──────────────────────────────────────

  function hasUnsavedChanges() {
    // Check if edit modal is open with potentially modified values
    if (editingId && !document.getElementById('edit-modal').hidden) {
      return true;
    }
    // Check if add modal is open with content
    const addModal = document.getElementById('add-modal');
    if (addModal && !addModal.hidden) {
      const title = document.getElementById('add-title').value.trim();
      const link = document.getElementById('add-link').value.trim();
      const content = document.getElementById('add-content').value.trim();
      if (title || link || content) return true;
    }
    return false;
  }

  function saveDraftToSession() {
    const draft = {};
    // Save edit modal state
    if (editingId && !document.getElementById('edit-modal').hidden) {
      draft.editModal = {
        id: editingId,
        lat: document.getElementById('edit-lat').value,
        lng: document.getElementById('edit-lng').value,
        location: document.getElementById('edit-location').value,
        area: document.getElementById('edit-area').value,
      };
    }
    // Save add modal state
    const addModal = document.getElementById('add-modal');
    if (addModal && !addModal.hidden) {
      draft.addModal = {
        title: document.getElementById('add-title').value,
        source: document.getElementById('add-source').value,
        link: document.getElementById('add-link').value,
        content: document.getElementById('add-content').value,
      };
    }
    if (Object.keys(draft).length > 0) {
      sessionStorage.setItem('bat_admin_draft', JSON.stringify(draft));
    }
  }

  // ── Inactivity Timer ───────────────────────────────────────────────────────

  function initInactivityTimer(timeoutMs = 30 * 60 * 1000) {
    const WARNING_BEFORE = 5 * 60 * 1000; // 5 minutes before timeout
    let logoutTimer = null;
    let warningTimer = null;
    let countdownInterval = null;
    let warningShown = false;
    let stopped = false;

    const warningModal = document.getElementById('inactivity-modal');
    const countdownEl = document.getElementById('inactivity-countdown');
    const stayBtn = document.getElementById('inactivity-stay-btn');

    function hideWarning() {
      if (warningModal) warningModal.hidden = true;
      warningShown = false;
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }

    function showWarning() {
      warningShown = true;
      if (warningModal) warningModal.hidden = false;
      // Start countdown display
      let remaining = WARNING_BEFORE;
      updateCountdown(remaining);
      countdownInterval = setInterval(() => {
        remaining -= 1000;
        if (remaining <= 0) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        } else {
          updateCountdown(remaining);
        }
      }, 1000);
    }

    function updateCountdown(ms) {
      if (!countdownEl) return;
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function performTimeout() {
      if (stopped) return;
      // Auto-save draft if unsaved changes exist
      if (hasUnsavedChanges()) {
        saveDraftToSession();
      }
      // Clear session
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      const authClient = window.SupabaseAuthClient;
      if (authClient) {
        authClient.signOut().catch(() => {});
      }
      hideWarning();
      showLogin();
      showToast('Session expired due to inactivity', 'warning', 5000);
    }

    function resetTimer() {
      if (stopped) return;
      clearTimeout(logoutTimer);
      clearTimeout(warningTimer);
      hideWarning();

      sessionStorage.setItem('bat_admin_last_activity', Date.now().toString());

      // Set warning timer (fires at timeoutMs - WARNING_BEFORE)
      warningTimer = setTimeout(() => {
        if (!stopped) showWarning();
      }, timeoutMs - WARNING_BEFORE);

      // Set logout timer (fires at timeoutMs)
      logoutTimer = setTimeout(() => {
        if (!stopped) performTimeout();
      }, timeoutMs);
    }

    function stop() {
      stopped = true;
      clearTimeout(logoutTimer);
      clearTimeout(warningTimer);
      hideWarning();
      events.forEach(evt => document.removeEventListener(evt, resetTimer));
    }

    // Track user activity with passive listeners
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(evt => document.addEventListener(evt, resetTimer, { passive: true }));

    // "Stay Logged In" button in warning modal
    if (stayBtn) {
      stayBtn.addEventListener('click', () => {
        resetTimer();
      });
    }

    // Initial start
    resetTimer();

    return { reset: resetTimer, stop };
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  async function boot() {
    // Wait briefly for SupabaseAuthClient to be available (loaded as ES module)
    let retries = 0;
    while (!window.SupabaseAuthClient && retries < 20) {
      await new Promise(r => setTimeout(r, 50));
      retries++;
    }

    if (token && await checkAuth()) {
      // Token still valid on server — try to get display name from Supabase session
      const authClient = window.SupabaseAuthClient;
      let displayName = 'Admin';
      if (authClient) {
        const session = await authClient.getSession();
        if (session && session.user) {
          displayName = getAdminDisplayName(session.user);
          // Refresh the token from current Supabase session
          token = session.access_token;
          sessionStorage.setItem(TOKEN_KEY, token);
        }
      }
      showApp(displayName);
      await loadConfig();
      loadData();
    } else {
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      showLogin();
    }
  }

  boot();
})();
