(function () {
  'use strict';

  const CFG      = window.BAT_CONFIG || {};
  const API_BASE = (CFG.apiBase || '').replace(/\/$/, '');

  const SEV_COLOR = { fatal: '#ef4444', serious: '#f59e0b', minor: '#10b981' };

  // ── Utilities ──────────────────────────────────────────────────────────────

  function inferZone(area) {
    const s = String(area || '').toLowerCase();
    if (/east|whitefield|kr puram|indiranagar|marathahalli|varthur|kadubeesanahalli|hopefarm|kadugodi|sarjapur|domlur|carmelaram|mahadevapura|bellandur|hsr|koramangala/.test(s)) return 'East';
    if (/north|hebbal|yelahanka|jakkur|kodigehalli|bellary|tumkur|peenya|mathikere|rt nagar|yeshwanthpur|nagavara|manyata|kamanahalli|banaswadi/.test(s)) return 'North';
    if (/south|jayanagar|jp nagar|bannerghatta|arekere|banashankari|btm|silk|hosur|electronic|nice|kengeri|mysore/.test(s)) return 'South';
    if (/west|rajajinagar|vijayanagar|magadi|jalahalli/.test(s)) return 'West';
    if (/central|mg road|majestic|shivaji|richmond|cantonment|ulsoor|cbd/.test(s)) return 'Central';
    if (/nh|highway|outer ring|orr|nh-44/.test(s)) return 'Highway / ORR';
    return 'Other';
  }

  function sevLabel(sev) {
    return sev === 'fatal' ? 'Critical' : sev === 'serious' ? 'Moderate' : 'Minor';
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  // ── Data loading ───────────────────────────────────────────────────────────

  function rowToFeature(row) {
    if (!row.hasCoords || row.lat == null || row.lng == null) return null;
    const sev = row.severity;
    if (!['fatal', 'serious', 'minor'].includes(sev)) return null;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+row.lng, +row.lat] },
      properties: {
        id: row.id, title: row.title, source: row.source || '',
        link: row.link || '', location: row.location || '',
        area: row.area || '', zone: row.zone || inferZone(row.area),
        severity: sev, score: row.score ?? null,
        date: row.date || row.date_raw || '—',
        isUser: row.source === 'user',
      },
    };
  }

  async function loadJsonFallback() {
    const res = await fetch('accident_data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('accident_data.json not found');
    const rows = await res.json();
    return { type: 'FeatureCollection', features: rows.map(rowToFeature).filter(Boolean) };
  }

  async function loadFromApi(query) {
    const qs = new URLSearchParams();
    if (query.from)                              qs.set('from',     query.from);
    if (query.to)                                qs.set('to',       query.to);
    if (query.severity && query.severity !== 'all') qs.set('severity', query.severity);
    if (query.area     && query.area     !== 'all') qs.set('area',     query.area);
    if (query.zone     && query.zone     !== 'all') qs.set('zone',     query.zone);
    const res = await fetch(`${API_BASE}/api/accidents?${qs}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const fc = await res.json();
    if (!fc || fc.type !== 'FeatureCollection') return emptyFC();
    fc.features = (fc.features || []).map(f => ({
      ...f,
      properties: {
        ...f.properties,
        zone: f.properties.zone || inferZone(f.properties.area),
        date: f.properties.date || f.properties.date_raw || '—',
        isUser: false,
      },
    }));
    return fc;
  }

  function mergeUserReports(fc) {
    if (!window.DB?.getAccidents) return fc;
    const extra = window.DB.getAccidents()
      .filter(a => a.source === 'user' && a.lat != null && a.lng != null)
      .map(a => rowToFeature({ ...a, hasCoords: true }))
      .filter(Boolean);
    return { type: 'FeatureCollection', features: fc.features.concat(extra) };
  }

  function clientFilter(fc, filters) {
    let feats = fc.features.slice();
    if (filters.severity && filters.severity !== 'all') feats = feats.filter(f => f.properties.severity === filters.severity);
    if (filters.area     && filters.area     !== 'all') feats = feats.filter(f => f.properties.area     === filters.area);
    if (filters.zone     && filters.zone     !== 'all') feats = feats.filter(f => f.properties.zone     === filters.zone);
    if (filters.from) feats = feats.filter(f => { const d = f.properties.date; return d && d !== '—' && String(d) >= filters.from; });
    if (filters.to)   feats = feats.filter(f => { const d = f.properties.date; return d && d !== '—' && String(d) <= filters.to;   });
    return { type: 'FeatureCollection', features: feats };
  }

  async function loadAll(filters) {
    let fc = emptyFC(), label = 'Local JSON';
    if (API_BASE) {
      try   { fc = await loadFromApi(filters); label = 'PostgreSQL + PostGIS'; }
      catch (e) {
        console.warn('API offline — falling back to JSON', e);
        try { fc = await loadJsonFallback(); label = 'Local JSON (API offline)'; } catch {}
      }
    } else {
      try { fc = await loadJsonFallback(); } catch {}
    }
    fc = mergeUserReports(fc);
    fc = clientFilter(fc, filters);
    return { fc, label };
  }

  // ── MapLibre GL JS Map ──────────────────────────────────────────────────────

  let map          = null;
  let isMapLoaded  = false;
  let pendingData  = null;
  let heatOn       = false;

  function initMap() {
    if (map) return;

    map = new maplibregl.Map({
      container: 'accident-map',
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [77.5946, 12.9716],
      zoom: 11.5,
      pitch: 45, // tilt for 3D buildings view
    });

    // Add navigation controls (zoom, rotate)
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      isMapLoaded = true;

      // Add dynamic accidents GeoJSON source
      map.addSource('accidents', {
        type: 'geojson',
        data: pendingData || emptyFC()
      });

      // Heatmap layer configuration (calculates on GPU)
      map.addLayer({
        id: 'accidents-heat',
        type: 'heatmap',
        source: 'accidents',
        maxzoom: 15,
        layout: {
          visibility: heatOn ? 'visible' : 'none'
        },
        paint: {
          'heatmap-weight': [
            'interpolate',
            ['linear'],
            ['get', 'score'],
            0, 0,
            10, 1
          ],
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 1,
            15, 3
          ],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, '#10b981',
            0.5, '#f59e0b',
            0.8, '#ef4444',
            1.0, '#991b1b'
          ],
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 5,
            15, 25
          ],
          'heatmap-opacity': 0.85
        }
      });

      // Point marker layer configuration
      map.addLayer({
        id: 'accidents-point',
        type: 'circle',
        source: 'accidents',
        minzoom: 8,
        layout: {
          visibility: heatOn ? 'none' : 'visible'
        },
        paint: {
          'circle-radius': [
            'match',
            ['get', 'severity'],
            'fatal', 8,
            'serious', 6,
            'minor', 5,
            5
          ],
          'circle-color': [
            'match',
            ['get', 'severity'],
            'fatal', '#ef4444',
            'serious', '#f59e0b',
            'minor', '#3b82f6',
            '#3b82f6'
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });

      // Handle interactive point clicks (Mapbox-style popups)
      map.on('click', 'accidents-point', (e) => {
        const coordinates = e.features[0].geometry.coordinates.slice();
        const p = e.features[0].properties;

        // Open details panel in sidebar
        openDetail({
          ...p,
          date: p.date,
          isUser: p.isUser === 'true' || p.isUser === true
        });

        // Show Leaflet-like styled popup on canvas
        const sev = p.severity;
        const hasLink = p.link && p.link !== '#' && /^https?:\/\//i.test(p.link);
        const html = `
          <div class="popup-inner">
            <span class="popup-sev popup-sev--${sev}">${sevLabel(sev)}</span>
            <div class="popup-title">${esc(p.title)}</div>
            <div class="popup-meta">
              <div><span>Date: </span>${esc(String(p.date))}</div>
              <div><span>Area: </span>${esc(p.area || '—')}</div>
              <div><span>Zone: </span>${esc(p.zone || '—')}</div>
            </div>
            ${hasLink ? `<a class="popup-link" href="${esc(p.link)}" target="_blank" rel="noopener">Read article ↗</a>` : ''}
          </div>
        `;

        // Ensure popup doesn't clip off map boundaries
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        new maplibregl.Popup({ offset: 10 })
          .setLngLat(coordinates)
          .setHTML(html)
          .addTo(map);
      });

      // Toggle cursor pointer on point hover
      map.on('mouseenter', 'accidents-point', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'accidents-point', () => {
        map.getCanvas().style.cursor = '';
      });

      // Load pending data if loaded in backend before style resolved
      if (pendingData) {
        updateMap(pendingData);
        pendingData = null;
      }
    });

    window.__BAT_MAP = map;
  }

  function updateMap(fc) {
    if (!isMapLoaded) {
      pendingData = fc;
      return;
    }
    const source = map.getSource('accidents');
    if (source) {
      source.setData(fc);
    }
  }

  // ── Detail panel ──────────────────────────────────────────────────────────

  function openDetail(p) {
    const panel = document.getElementById('detail-panel');
    const body  = document.getElementById('detail-panel-body');
    if (!panel || !body) return;
    const sev = p.severity;
    const hasLink = p.link && p.link !== '#' && /^https?:\/\//i.test(p.link);
    body.innerHTML = `
      <span class="dp-badge dp-badge--${sev}">${sevLabel(sev)}</span>
      <div class="dp-headline">${esc(p.title)}</div>
      <div class="dp-rows">
        <div class="dp-row"><span class="dp-key">Date</span>    <span class="dp-val">${esc(String(p.date))}</span></div>
        <div class="dp-row"><span class="dp-key">Area</span>    <span class="dp-val">${esc(p.area || '—')}</span></div>
        <div class="dp-row"><span class="dp-key">Zone</span>    <span class="dp-val">${esc(p.zone || '—')}</span></div>
        <div class="dp-row"><span class="dp-key">Location</span><span class="dp-val">${esc(p.location || '—')}</span></div>
        <div class="dp-row"><span class="dp-key">Source</span>  <span class="dp-val">${esc(p.source || '—')}${p.isUser ? ' <em>(user report)</em>' : ''}</span></div>
      </div>
      ${hasLink ? `<a class="dp-link" href="${esc(p.link)}" target="_blank" rel="noopener">Read full article ↗</a>` : ''}
    `;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
  }

  function closeDetail() {
    const panel = document.getElementById('detail-panel');
    if (panel) { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
  }

  // ── Stats & hotspots ──────────────────────────────────────────────────────

  function updateStats(fc) {
    const f = fc.features;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-total',   f.length);
    set('stat-fatal',   f.filter(x => x.properties.severity === 'fatal').length);
    set('stat-serious', f.filter(x => x.properties.severity === 'serious').length);
    set('stat-minor',   f.filter(x => x.properties.severity === 'minor').length);
  }

  function updateHotspots(fc) {
    const areaMap = {};
    fc.features.forEach(f => {
      const p = f.properties;
      const a = p.area || 'Unknown';
      if (!areaMap[a]) areaMap[a] = { area: a, total: 0, fatal: 0, serious: 0, minor: 0, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      areaMap[a].total++;
      areaMap[a][p.severity]++;
    });

    const list = Object.values(areaMap)
      .sort((a, b) => b.total - a.total)
      .map((h, i) => ({ ...h, rank: i + 1 }));

    const badge = document.getElementById('hotspot-count-badge');
    if (badge) badge.textContent = list.length + ' areas';

    const el = document.getElementById('hotspot-list');
    if (!el) return;
    const max = list[0]?.total || 1;

    el.innerHTML = list.slice(0, 12).map((h, i) => {
      const rc  = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
      const pct = Math.round((h.total / max) * 100);
      return `
        <li class="hotspot-item" data-lat="${h.lat}" data-lng="${h.lng}">
          <div class="h-rank ${rc}">${h.rank}</div>
          <div class="h-info">
            <div class="h-name">${esc(h.area)}</div>
            <div class="h-dots">
              <span style="color:#dc2626">● ${h.fatal}</span>
              <span style="color:#d97706">● ${h.serious}</span>
              <span style="color:#3b82f6">● ${h.minor}</span>
            </div>
            <div class="h-bar-wrap"><div class="h-bar" style="width:${pct}%"></div></div>
          </div>
          <div class="h-count">${h.total}</div>
        </li>`;
    }).join('');

    el.querySelectorAll('.hotspot-item').forEach(item => {
      item.addEventListener('click', () => {
        if (map && isMapLoaded) {
          map.flyTo({
            center: [parseFloat(item.dataset.lng), parseFloat(item.dataset.lat)],
            zoom: 14,
            essential: true,
            speed: 1.2
          });
        }
      });
    });
  }

  // ── Filter helpers ─────────────────────────────────────────────────────────

  function readFilters() {
    return {
      severity: document.getElementById('filter-severity')?.value || 'all',
      area:     document.getElementById('filter-area')?.value     || 'all',
      zone:     document.getElementById('filter-zone')?.value     || 'all',
      from:     document.getElementById('filter-from')?.value     || '',
      to:       document.getElementById('filter-to')?.value       || '',
    };
  }

  function fillSelect(id, values, current) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const label = id === 'filter-zone' ? 'All Zones' : 'All Areas';
    const prev  = sel.value || current;
    sel.innerHTML = `<option value="all">${label}</option>`;
    values.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  }

  function unique(arr) {
    return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  async function bootstrap() {
    initMap();

    async function refresh() {
      const filters = readFilters();
      const { fc, label } = await loadAll(filters);

      const badge = document.getElementById('data-source-badge');
      if (badge) badge.textContent = label;

      fillSelect('filter-area', unique(fc.features.map(f => f.properties.area)), filters.area);
      fillSelect('filter-zone', unique(fc.features.map(f => f.properties.zone)), filters.zone);

      updateStats(fc);
      updateHotspots(fc);
      updateMap(fc);
    }

    document.getElementById('apply-filters-btn')?.addEventListener('click', refresh);
    document.getElementById('reset-filters-btn')?.addEventListener('click', () => {
      ['filter-severity', 'filter-area', 'filter-zone', 'filter-from', 'filter-to'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = el.tagName === 'SELECT' ? 'all' : '';
      });
      refresh();
    });

    document.getElementById('toggle-heatmap')?.addEventListener('change', e => {
      heatOn = e.target.checked;
      if (!map || !isMapLoaded) return;
      if (map.getLayer('accidents-heat')) {
        map.setLayoutProperty('accidents-heat', 'visibility', heatOn ? 'visible' : 'none');
      }
      if (map.getLayer('accidents-point')) {
        map.setLayoutProperty('accidents-point', 'visibility', heatOn ? 'none' : 'visible');
      }
    });

    document.getElementById('detail-panel-close')?.addEventListener('click', closeDetail);

    await refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
