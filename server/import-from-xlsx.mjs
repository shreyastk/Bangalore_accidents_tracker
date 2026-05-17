/**
 * Reads Database/Bangalore Accidents Tracker.xlsx and writes Frontend/accident_data.json
 *
 * Expected columns (case-insensitive): DATE, Title, Link (HYPERLINK formula), Location,
 * Latitude, Longitude, Score, Geotag (optional area/ward label).
 *
 * Run: npm run import:xlsx
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const XLSX_PATH = path.join(ROOT, 'Database', 'Bangalore Accidents Tracker.xlsx');
const OUT_JSON = path.join(ROOT, 'Frontend', 'accident_data.json');

const COLUMN_ALIASES = {
  id: ['id', 'article_id', 'incident_id', 'case_id', 'sr no', 'sr.no', 's.no', 'no'],
  title: ['title', 'headline', 'article title', 'incident', 'description'],
  source: ['source', 'publication', 'publisher', 'media'],
  link: ['link', 'url', 'article link', 'news link', 'source link'],
  location: ['location', 'place', 'address', 'site', 'where'],
  area: ['area', 'ward', 'locality', 'corridor', 'region', 'neighborhood', 'geotag'],
  lat: ['lat', 'latitude', 'y'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x'],
  score: ['score', 'severity score', 'weight', 'priority'],
  severity: ['severity', 'level', 'class', 'type'],
  date: ['date', 'accident date', 'incident date', 'published', 'day'],
};

function normKey(k) {
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildHeaderMap(headers) {
  const byNorm = {};
  for (const h of headers) {
    byNorm[normKey(h)] = h;
  }
  const resolved = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const a of aliases) {
      const n = normKey(a);
      if (byNorm[n]) {
        resolved[field] = byNorm[n];
        break;
      }
    }
  }
  return resolved;
}

function cell(row, headerMap, field) {
  const col = headerMap[field];
  if (!col) return undefined;
  const v = row[col];
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' && field !== 'title' && field !== 'location') return v;
  return String(v).trim();
}

function extractUrlFromHyperlinkFormula(f) {
  if (!f || typeof f !== 'string' || !f.includes('HYPERLINK')) return '';
  const m = f.match(/HYPERLINK\s*\(\s*([\s\S]*?)\s*,\s*"[^"]*"\s*\)/i);
  if (!m) {
    const parts = f.match(/https?:\/\/[^"&]+/g);
    return parts?.length ? parts.join('') : '';
  }
  const arg = m[1].trim();
  const segs = arg.split(/"\s*&\s*"/).map((s) => s.replace(/^"+|"+$/g, ''));
  const url = segs.join('');
  return /^https?:\/\//i.test(url) ? url : '';
}

function splitTitleSource(rawTitle) {
  const t = String(rawTitle || '').trim();
  const idx = t.lastIndexOf(' - ');
  if (idx === -1) return { title: t, source: 'Unknown' };
  const left = t.slice(0, idx).trim();
  const right = t.slice(idx + 3).trim();
  if (!left) return { title: t, source: 'Unknown' };
  return { title: left, source: right || 'Unknown' };
}

// Map link domains → clean publication names
const DOMAIN_SOURCES = {
  'ndtv.com':                   'NDTV',
  'thehindu.com':               'The Hindu',
  'deccanherald.com':           'Deccan Herald',
  'deccanchronicle.com':        'Deccan Chronicle',
  'timesofindia.indiatimes.com':'Times of India',
  'bangaloremirror.indiatimes.com': 'Bangalore Mirror',
  'thenewsminute.com':          'The News Minute',
  'newindianexpress.com':       'New Indian Express',
  'indiatoday.in':              'India Today',
  'hindustantimes.com':         'Hindustan Times',
  'news18.com':                 'News18',
  'scroll.in':                  'Scroll',
  'thewire.in':                 'The Wire',
  'firstpost.com':              'Firstpost',
  'tribuneindia.com':           'The Tribune',
  'business-standard.com':      'Business Standard',
};

function sourceFromLink(url) {
  if (!url || url === '#' || url.includes('news.google.com')) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, name] of Object.entries(DOMAIN_SOURCES)) {
      if (host === domain || host.endsWith('.' + domain)) return name;
    }
    // Fallback: capitalise the domain root e.g. scroll.in → Scroll
    return host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
  } catch {
    return null;
  }
}

function parseSeverityLabel(raw) {
  const s = normKey(raw);
  if (!s) return null;
  if (/fatal|death|killed|critical|deceased/i.test(s)) return 'fatal';
  if (/serious|major|grievous|severe|injury|hospital/i.test(s)) return 'serious';
  if (/minor|low|light/i.test(s)) return 'minor';
  if (s === 'fatal' || s === 'serious' || s === 'minor') return s;
  return null;
}

function severityFromScore(score) {
  if (score == null || Number.isNaN(score)) return 'minor';
  if (score >= 9) return 'fatal';
  if (score >= 4) return 'serious';
  return 'minor';
}

function parseDate(raw) {
  if (raw === undefined || raw === null || raw === '') return 'Unknown';
  if (raw instanceof Date && !isNaN(raw)) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === 'number' && XLSX.SSF) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) {
      const y = parsed.y;
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  const str = String(raw).trim();
  if (!str) return 'Unknown';
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    let a = parseInt(dmy[1], 10);
    let b = parseInt(dmy[2], 10);
    let yy = parseInt(dmy[3], 10);
    if (yy < 100) yy += 2000;
    let dd = a;
    let mm = b;
    if (b > 12) {
      dd = b;
      mm = a;
    }
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return str.length > 64 ? str.slice(0, 64) : str;
}

function parseNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function slugId(prefix, i) {
  return `${prefix}${String(i + 1).padStart(3, '0')}`;
}

function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error('Missing file:', XLSX_PATH);
    process.exit(1);
  }

  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true, raw: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  if (!rows.length || !aoa.length) {
    console.error('Sheet is empty:', sheetName);
    process.exit(1);
  }

  const headers = Object.keys(rows[0]);
  const headerMap = buildHeaderMap(headers);

  if (!headerMap.title) {
    console.error('Could not map Title column. Found:', headers);
    process.exit(1);
  }

  const hdrNorm = aoa[0].map((h) => normKey(String(h ?? '')));
  const linkColIdx = hdrNorm.indexOf('link');

  const out = [];
  let skipped = 0;

  rows.forEach((row, i) => {
    const rawTitle = cell(row, headerMap, 'title');
    if (!rawTitle) {
      skipped++;
      return;
    }

    const { title, source: srcFromTitle } = splitTitleSource(rawTitle);
    const lat = headerMap.lat ? parseNum(cell(row, headerMap, 'lat')) : null;
    const lng = headerMap.lng ? parseNum(cell(row, headerMap, 'lng')) : null;
    const hasCoords = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

    let id = cell(row, headerMap, 'id');
    if (!id) id = slugId('xlsx', i);

    const rawDate = row[headerMap.date];
    const date = parseDate(rawDate !== undefined && rawDate !== '' ? rawDate : cell(row, headerMap, 'date'));

    const score = parseNum(cell(row, headerMap, 'score'));
    const labelSev = headerMap.severity ? parseSeverityLabel(cell(row, headerMap, 'severity')) : null;
    const severity = labelSev || severityFromScore(score);

    let link = '#';
    if (linkColIdx >= 0) {
      const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: linkColIdx });
      const c = sheet[cellRef];
      const url = extractUrlFromHyperlinkFormula(c?.f);
      if (url) link = url;
    }
    if (link === '#') {
      const fallback = cell(row, headerMap, 'link');
      if (fallback && /^https?:\/\//i.test(fallback)) link = fallback;
    }

    const areaCell = cell(row, headerMap, 'area');
    const area = areaCell && String(areaCell).trim() ? String(areaCell).trim() : 'Bangalore';

    // Prefer source derived from actual link domain (avoids title/link shift mismatch)
    const linkSource = sourceFromLink(link);
    const source = linkSource || cell(row, headerMap, 'source') || srcFromTitle;

    out.push({
      id: String(id),
      title,
      source,
      link,
      location: cell(row, headerMap, 'location') || title,
      area,
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      score: score ?? 0,
      severity,
      date,
      hasCoords,
    });
  });

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${out.length} records to ${OUT_JSON} (sheet: ${sheetName}, skipped empty title: ${skipped})`);
}

main();
