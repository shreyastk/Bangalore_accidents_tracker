const API = (window.BAT_CONFIG?.apiBase || 'http://localhost:3000').replace(/\/$/, '');

async function fetchJson(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.json();
}

function hexToRGBA(hex, alpha=1){
  const h = hex.replace('#','');
  const bigint = parseInt(h,16);
  const r = (bigint>>16)&255; const g = (bigint>>8)&255; const b = bigint&255;
  return `rgba(${r},${g},${b},${alpha})`;
}

async function renderAll() {
  try {
    const [monthly, byTime, byArea] = await Promise.all([
      fetchJson('/api/stats/trends'),
      fetchJson('/api/stats/by-time'),
      fetchJson('/api/stats/by-area')
    ]);

    renderTrendsChart(monthly || []);
    renderSeverityChart(monthly || []);
    renderAreasChart(byArea || []);
    renderByHourChart(byTime?.byHour || []);
    renderByDayChart(byTime?.byDay || []);
    renderHeatmap(byTime?.matrix || []);
  } catch (e) {
    console.error('Failed to load trends data', e);
  }
}

function renderTrendsChart(data) {
  const labels = (data || []).map(d => d.month);
  const totals = (data || []).map(d => Number(d.total || 0));
  const fatal = (data || []).map(d => Number(d.fatal || 0));
  const serious = (data || []).map(d => Number(d.serious || 0));
  const minor = (data || []).map(d => Number(d.minor || 0));

  const ctx = document.getElementById('chart-trends').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total', data: totals, borderColor: '#0ea5a4', backgroundColor: hexToRGBA('#0ea5a4',0.08), tension:0.25, fill:true },
        { label: 'Fatal', data: fatal, borderColor: '#dc2626', backgroundColor: hexToRGBA('#dc2626',0.06), tension:0.25 },
        { label: 'Serious', data: serious, borderColor: '#f59e0b', backgroundColor: hexToRGBA('#f59e0b',0.06), tension:0.25 },
        { label: 'Minor', data: minor, borderColor: '#3b82f6', backgroundColor: hexToRGBA('#3b82f6',0.06), tension:0.25 }
      ]
    },
    options: {
      responsive:true,
      plugins: { legend: { position: 'top' } },
      scales: { x: { grid: { display:false } }, y: { beginAtZero:true } }
    }
  });
}

function renderSeverityChart(monthly) {
  // sum across months
  const sum = { fatal:0, serious:0, minor:0 };
  (monthly || []).forEach(m => { sum.fatal += Number(m.fatal||0); sum.serious += Number(m.serious||0); sum.minor += Number(m.minor||0); });
  const ctx = document.getElementById('chart-severity').getContext('2d');
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Fatal','Serious','Minor'],
      datasets: [{ data: [sum.fatal, sum.serious, sum.minor], backgroundColor: ['#dc2626','#f59e0b','#3b82f6'] }]
    },
    options: { responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });
}

function renderAreasChart(areaData) {
  const sorted = (areaData || []).sort((a,b)=>b.total - a.total).slice(0,10);
  const labels = sorted.map(r=>r.area + (r.zone?(' — '+r.zone):''));
  const vals = sorted.map(r=>Number(r.total||0));
  const ctx = document.getElementById('chart-areas').getContext('2d');
  new Chart(ctx, { type:'bar', data:{ labels, datasets:[{ label:'Incidents', data:vals, backgroundColor: '#6b7280' }] }, options:{ indexAxis:'y', responsive:true, plugins:{ legend:{ display:false } }, scales:{ x:{ beginAtZero:true } } } });
}

function renderByHourChart(hours) {
  const labels = Array.from({length:24}, (_,i)=>String(i));
  const data = (hours && hours.length===24) ? hours.map(n=>Number(n||0)) : labels.map(()=>0);
  const ctx = document.getElementById('chart-byhour').getContext('2d');
  new Chart(ctx, { type:'bar', data:{ labels, datasets:[{ label:'Incidents', data, backgroundColor:'#3b82f6' }] }, options:{ responsive:true, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false } }, y:{ beginAtZero:true } } } });
}

function renderByDayChart(days) {
  const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const data = (days && days.length===7) ? days.map(n=>Number(n||0)) : labels.map(()=>0);
  const ctx = document.getElementById('chart-byday').getContext('2d');
  new Chart(ctx, { type:'bar', data:{ labels, datasets:[{ label:'Incidents', data, backgroundColor:'#f59e0b' }] }, options:{ responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } } } });
}

function renderHeatmap(matrix) {
  const container = document.getElementById('heatmap');
  if (!container) return;
  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const rows = (matrix && matrix.length === 7) ? matrix : dayLabels.map(() => new Array(24).fill(0));

  let max = 0;
  rows.forEach(row => row.forEach(v => { if (Number(v) > max) max = Number(v); }));

  container.innerHTML = '';

  // Header row: blank corner cell + hour labels
  const corner = document.createElement('div');
  container.appendChild(corner);
  for (let h = 0; h < 24; h++) {
    const label = document.createElement('div');
    label.className = 'heatmap-hour-label';
    label.textContent = (h % 3 === 0) ? String(h) : '';
    container.appendChild(label);
  }

  // One row per day: label + 24 hour cells
  rows.forEach((row, dayIdx) => {
    const dayLabel = document.createElement('div');
    dayLabel.className = 'heatmap-label';
    dayLabel.textContent = dayLabels[dayIdx];
    container.appendChild(dayLabel);

    row.forEach((count, hourIdx) => {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      const intensity = max > 0 ? Number(count) / max : 0;
      cell.style.background = hexToRGBA('#dc2626', 0.06 + intensity * 0.9);
      cell.title = `${dayLabels[dayIdx]} ${String(hourIdx).padStart(2,'0')}:00 — ${count} incident${count === 1 ? '' : 's'}`;
      container.appendChild(cell);
    });
  });
}

// Refresh & CSV download (CSV will call existing /api/accidents?format=csv if implemented later)
document.getElementById('refresh-btn')?.addEventListener('click', () => { renderAll(); });
document.getElementById('download-csv')?.addEventListener('click', (e) => {
  e.preventDefault();
  const url = API + '/api/accidents?format=csv';
  window.open(url, '_blank');
});

document.getElementById('download-geojson')?.addEventListener('click', (e) => {
  e.preventDefault();
  const url = API + '/api/export/geojson';
  window.open(url, '_blank');
});

// Init
renderAll();

export {};
