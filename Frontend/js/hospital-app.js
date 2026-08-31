/**
 * hospital-app.js — Hospital directory + emergency alerts.
 * Loads the public hospital directory (searchable, paginated) and, for
 * hospital-role users, live emergency alerts. Unauthorized users get a
 * friendly notice instead of a hard "failed to load" error.
 */
const API = (window.BAT_CONFIG?.apiBase || 'http://localhost:3000').replace(/\/$/, '');

/* ── Toast ─────────────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast--removing');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

/* ── Auth token ────────────────────────────────────────────────────── */
async function getToken() {
  let retries = 0;
  while (!window.SupabaseAuthClient && retries++ < 20) await new Promise(r => setTimeout(r, 50));
  const client = window.SupabaseAuthClient;
  if (!client) return null;
  const session = await client.getSession();
  return session ? session.access_token : null;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Hospital directory ────────────────────────────────────────────── */
const directoryState = { q: '', offset: 0, limit: 60, total: 0 };

function setListState(el, html) {
  if (el) el.innerHTML = html;
}

async function fetchHospitals(q, offset, limit) {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q) qs.set('q', q);
  const res = await fetch(`${API}/api/hospitals?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

function renderHospitalCards(list, append) {
  const container = document.getElementById('hospital-list');
  if (!container) return;

  if (!append) container.innerHTML = '';
  if (!list || !list.length) {
    container.innerHTML = '<div class="list-state">No hospitals match your search.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach(h => {
    const card = document.createElement('div');
    card.className = 'hospital-card';

    const name = document.createElement('h3');
    name.className = 'hospital-name';
    name.textContent = h.name || 'Unnamed hospital';

    const phone = h.phone
      ? `<a class="hospital-phone" href="tel:${esc(h.phone)}">📞 ${esc(h.phone)}</a>`
      : '<span class="hospital-phone text-muted">📞 Phone unavailable</span>';

    const address = h.address
      ? `<p class="hospital-address">📍 ${esc(h.address)}</p>`
      : '<p class="hospital-address text-muted">📍 Address unavailable</p>';

    const mapsHref = (h.lat != null && h.lng != null)
      ? `https://www.google.com/maps?q=${h.lat},${h.lng}`
      : null;

    const actions = document.createElement('div');
    actions.className = 'hospital-actions';
    if (mapsHref) {
      const m = document.createElement('a');
      m.className = 'btn btn-outline btn-sm';
      m.href = mapsHref;
      m.target = '_blank';
      m.rel = 'noopener';
      m.textContent = 'Open Map';
      actions.appendChild(m);
    }

    card.innerHTML = `<div class="hospital-card-head">${name.outerHTML}</div>${phone}${address}`;
    card.appendChild(actions);
    frag.appendChild(card);
  });

  if (append) {
    container.appendChild(frag);
  } else {
    container.appendChild(frag);
  }
}

function updateResultsInfo() {
  const el = document.getElementById('results-info');
  if (!el) return;
  const shown = Math.min(directoryState.offset + directoryState.limit, directoryState.total);
  el.textContent = directoryState.total > 0
    ? `Showing ${shown} of ${directoryState.total.toLocaleString()} hospitals`
    : '';
  const moreBtn = document.getElementById('load-more-btn');
  if (moreBtn) moreBtn.hidden = shown >= directoryState.total;
}

async function loadHospitals(reset = true) {
  const listEl = document.getElementById('hospital-list');
  const btn = document.getElementById('load-more-btn');
  if (reset) {
    directoryState.offset = 0;
    setListState(listEl, '<div class="list-state">Loading hospitals…</div>');
  }
  if (btn) btn.hidden = true;
  try {
    const data = await fetchHospitals(directoryState.q, directoryState.offset, directoryState.limit);
    directoryState.total = data.total || 0;
    const countEl = document.getElementById('hospital-count');
    if (countEl) countEl.textContent = (data.total || 0).toLocaleString();

    renderHospitalCards(data.hospitals || [], !reset);
    directoryState.offset += (data.hospitals || []).length;
    updateResultsInfo();
  } catch (e) {
    console.error('Failed to load hospitals', e);
    setListState(listEl, '<div class="list-state list-state--error">Failed to load hospitals. Is the API running?</div>');
  }
}

/* ── Emergency alerts ──────────────────────────────────────────────── */
let myLocation = null;
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => { myLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
    () => { myLocation = null; },
    { enableHighAccuracy: false, timeout: 8000 }
  );
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initMiniMap(el, lat, lng) {
  if (!window.L || lat == null || lng == null) return;
  try {
    const map = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView([lat, lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
    L.marker([lat, lng]).addTo(map);
  } catch (e) { console.error('Mini-map init failed', e); }
}

function renderAlerts(list) {
  const container = document.getElementById('alerts');
  if (!container) return;
  if (!list || !list.length) {
    container.innerHTML = '<div class="list-state">No recent alerts</div>';
    const card = document.getElementById('alert-count-card');
    if (card) card.hidden = true;
    return;
  }
  container.innerHTML = '';
  const card = document.getElementById('alert-count-card');
  if (card) { card.hidden = false; document.getElementById('alert-count').textContent = list.length; }

  list.forEach(a => {
    const el = document.createElement('div');
    el.className = 'alert-card';

    const sev = a.severity || 'minor';
    const badge = `<span class="badge badge-${sev}">${esc(sev.toUpperCase())}</span>`;
    const time = a.created_at ? new Date(a.created_at).toLocaleString() : '—';
    const mapsHref = (a.lat != null && a.lng != null)
      ? `https://www.google.com/maps?q=${a.lat},${a.lng}`
      : null;

    // Photo + mini-map + distance
    const media = document.createElement('div');
    media.className = 'alert-media';
    if (a.photo_url) {
      const img = document.createElement('img');
      img.className = 'alert-photo';
      img.src = a.photo_url;
      img.alt = 'Emergency scene photo';
      img.loading = 'lazy';
      media.appendChild(img);
    }
    if (a.lat != null && a.lng != null) {
      const mapEl = document.createElement('div');
      mapEl.className = 'alert-minimap';
      media.appendChild(mapEl);
      setTimeout(() => initMiniMap(mapEl, Number(a.lat), Number(a.lng)), 0);
    }
    if (a.lat != null && a.lng != null && myLocation) {
      const dist = haversineKm(myLocation.lat, myLocation.lng, Number(a.lat), Number(a.lng));
      const distEl = document.createElement('span');
      distEl.className = 'alert-distance';
      distEl.textContent = `${dist.toFixed(1)} km away`;
      media.appendChild(distEl);
    }

    const actions = document.createElement('div');
    actions.className = 'alert-actions';
    if (mapsHref) {
      const m = document.createElement('a');
      m.className = 'btn btn-outline btn-sm';
      m.href = mapsHref; m.target = '_blank'; m.rel = 'noopener';
      m.textContent = 'Open Map';
      actions.appendChild(m);
    }
    const ackBtn = document.createElement('button');
    ackBtn.className = 'btn btn-primary btn-sm';
    ackBtn.textContent = a.status === 'acknowledged' ? 'Acknowledged' : 'Acknowledge';
    ackBtn.disabled = a.status === 'acknowledged';
    ackBtn.addEventListener('click', async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API}/api/hospital/alerts/${encodeURIComponent(a.id)}/ack`, {
          method: 'POST',
          headers: token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        ackBtn.textContent = 'Acknowledged';
        ackBtn.disabled = true;
        toast('Alert acknowledged', 'success');
      } catch (e) {
        console.error(e);
        toast('Acknowledge failed: ' + e.message, 'error');
      }
    });
    actions.appendChild(ackBtn);

    const body = document.createElement('div');
    body.className = 'alert-body';
    const head = document.createElement('div');
    head.className = 'alert-body-head';
    head.innerHTML = `${badge}<span class="alert-time">${esc(time)}</span>`;
    const title = document.createElement('h4');
    title.textContent = a.address || 'Unknown location';
    const desc = document.createElement('p');
    desc.className = 'text-muted';
    desc.textContent = a.description || '';

    if (media.childNodes.length) el.appendChild(media);
    el.appendChild(body);
    body.appendChild(head);
    body.appendChild(title);
    if (desc.textContent) body.appendChild(desc);
    body.appendChild(actions);
    container.appendChild(el);
  });
}

async function loadAlerts() {
  const statusEl = document.getElementById('poll-status');
  const container = document.getElementById('alerts');
  try {
    statusEl.textContent = 'Loading…';
    const token = await getToken();
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const res = await fetch(`${API}/api/hospital/alerts`, { headers, cache: 'no-store' });

    if (res.status === 401 || res.status === 403) {
      container.innerHTML = '<div class="list-state">Emergency alerts are restricted to hospital responders. <a href="login.html">Sign in</a> with a hospital account to view them.</div>';
      statusEl.textContent = 'Restricted';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const list = await res.json();
    renderAlerts(list);
    statusEl.textContent = 'Last: ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error('Failed to load alerts', e);
    statusEl.textContent = 'Error';
    container.innerHTML = '<div class="list-state list-state--error">Failed to load alerts</div>';
  }
}

/* ── Init ──────────────────────────────────────────────────────────── */
(function initNav() {
  const nav = document.getElementById('main-nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    onScroll();
  }
  const toggle = document.getElementById('nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => document.getElementById('nav-links').classList.toggle('open'));
  }
  window.Auth?.updateNavAuth?.();
})();

document.addEventListener('DOMContentLoaded', () => {
  loadHospitals(true);

  const search = document.getElementById('hospital-search');
  if (search) {
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        directoryState.q = search.value.trim();
        loadHospitals(true);
      }, 250);
    });
  }

  document.getElementById('load-more-btn')?.addEventListener('click', () => loadHospitals(false));
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    loadHospitals(true);
    loadAlerts();
  });

  loadAlerts();
  setInterval(loadAlerts, 15000);
});
