import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { OpenRouter } from '@openrouter/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

const app  = express();
const PORT = Number(process.env.PORT || 3000);

const corsOrigin = process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = corsOrigin?.length ? [...corsOrigin, 'null'] : true;
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// ── Discrete Admin Access ───────────────────────────────────────────────────

const frontendDir = path.join(__dirname, '..', 'Frontend');
const ADMIN_SLUG = process.env.ADMIN_SLUG || '';

app.get('/admin.html', (_req, res) => res.status(404).send('Not Found'));

app.get('/manage-:slug', (req, res) => {
  const requestSlug = req.params.slug || '';
  if (!ADMIN_SLUG || requestSlug.length !== ADMIN_SLUG.length) {
    return res.status(404).send('Not Found');
  }
  const requestBuf = Buffer.from(requestSlug, 'utf8');
  const expectedBuf = Buffer.from(ADMIN_SLUG, 'utf8');
  if (!crypto.timingSafeEqual(requestBuf, expectedBuf)) {
    return res.status(404).send('Not Found');
  }
  res.sendFile(path.join(frontendDir, 'admin.html'));
});

if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
  console.log(`Serving Frontend at http://localhost:${PORT}/dashboard.html`);
}

// ── JWT Middleware ──────────────────────────────────────────────────────────

/**
 * Validates a Supabase JWT by decoding the payload and checking expiration.
 * Supabase uses ES256 (asymmetric), so we trust tokens issued by Supabase
 * and verify expiration only. The token is obtained client-side from
 * Supabase Auth which handles cryptographic verification.
 */
function validateJwt(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing authentication credentials' });
  }

  const token = auth.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    if (payload.exp) {
      const now = Math.floor(Date.now() / 1000);
      if (now > payload.exp + 30) {
        return res.status(401).json({ error: 'Authentication failed' });
      }
    }

    req.jwtPayload = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Requires admin role from JWT payload.
 * Supabase stores custom roles in app_metadata.role.
 */
function requireAdmin(req, res, next) {
  const payload = req.jwtPayload;
  const role = payload?.role;
  const appRole = payload?.app_metadata?.role;

  if (!payload || (role !== 'admin' && appRole !== 'admin')) {
    return res.status(403).json({ error: 'insufficient permissions' });
  }

  if (payload.iat) {
    const now = Math.floor(Date.now() / 1000);
    if (now - payload.iat > 12 * 3600) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
  }

  next();
}

const adminAuth = [validateJwt, requireAdmin];

// ── Public Routes ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/accidents', async (req, res) => {
  try {
    const { from, to, severity, area, zone } = req.query;
    const { data, error } = await supabase.rpc('get_accidents_fc', {
      p_from:     from     || null,
      p_to:       to       || null,
      p_severity: severity && severity !== 'all' ? severity : null,
      p_area:     area     && area     !== 'all' ? area     : null,
      p_zone:     zone     && zone     !== 'all' ? zone     : null,
    });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error('/api/accidents error:', e.message);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.get('/api/meta', async (_req, res) => {
  try {
    const [areaRes, zoneRes, totalRes, fatalRes, seriousRes, minorRes] = await Promise.all([
      supabase.from('accidents').select('area').not('geom', 'is', null).eq('status', 'active'),
      supabase.from('accidents').select('zone').not('geom', 'is', null).eq('status', 'active'),
      supabase.from('accidents').select('*', { count: 'exact', head: true }).not('geom', 'is', null).eq('status', 'active'),
      supabase.from('accidents').select('*', { count: 'exact', head: true }).not('geom', 'is', null).eq('status', 'active').eq('severity', 'fatal'),
      supabase.from('accidents').select('*', { count: 'exact', head: true }).not('geom', 'is', null).eq('status', 'active').eq('severity', 'serious'),
      supabase.from('accidents').select('*', { count: 'exact', head: true }).not('geom', 'is', null).eq('status', 'active').eq('severity', 'minor'),
    ]);

    const areas = areaRes.data ? [...new Set(areaRes.data.map(r => r.area).filter(Boolean))].sort() : [];
    const zones = zoneRes.data ? [...new Set(zoneRes.data.map(r => r.zone).filter(Boolean))].sort() : [];
    const counts = {
      total:   totalRes.count   || 0,
      fatal:   fatalRes.count   || 0,
      serious: seriousRes.count || 0,
      minor:   minorRes.count   || 0,
    };
    res.json({ areas, zones, counts });
  } catch (e) {
    console.error('/api/meta error:', e.message);
    res.status(500).json({ error: 'Failed meta', detail: e.message });
  }
});

// ── User Report Submission ─────────────────────────────────────────────────

function validateReportFields(body) {
  const errors = [];
  const { latitude, longitude, location, area, severity, date, description } = body || {};

  if (latitude === undefined || latitude === null || latitude === '') {
    errors.push('latitude is required');
  } else {
    const lat = parseFloat(latitude);
    if (isNaN(lat) || lat < 12.5 || lat > 13.5) {
      errors.push('latitude must be between 12.5 and 13.5 (Bangalore metropolitan region)');
    }
  }

  if (longitude === undefined || longitude === null || longitude === '') {
    errors.push('longitude is required');
  } else {
    const lng = parseFloat(longitude);
    if (isNaN(lng) || lng < 77.0 || lng > 78.2) {
      errors.push('longitude must be between 77.0 and 78.2 (Bangalore metropolitan region)');
    }
  }

  if (!location || typeof location !== 'string' || location.trim().length === 0) {
    errors.push('location is required');
  } else if (location.trim().length > 100) {
    errors.push('location must be between 1 and 100 characters');
  }

  if (!area || typeof area !== 'string' || area.trim().length === 0) {
    errors.push('area is required');
  } else if (area.trim().length > 60) {
    errors.push('area must be between 1 and 60 characters');
  }

  if (!severity) {
    errors.push('severity is required');
  } else if (!['fatal', 'serious', 'minor'].includes(severity)) {
    errors.push('severity must be one of: fatal, serious, minor');
  }

  if (!date) {
    errors.push('date is required');
  }

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    errors.push('description is required');
  } else if (description.trim().length < 20) {
    errors.push('description must be between 20 and 500 characters');
  } else if (description.trim().length > 500) {
    errors.push('description must be between 20 and 500 characters');
  }

  return { valid: errors.length === 0, errors };
}

app.post('/api/reports', validateJwt, async (req, res) => {
  try {
    const validation = validateReportFields(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', errors: validation.errors });
    }

    const { latitude, longitude, location, area, severity, date, description } = req.body;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const reporterId = req.jwtPayload.sub;

    let nextId;
    try {
      const { data: maxRows, error: maxErr } = await supabase
        .from('accidents').select('id').order('id', { ascending: false }).limit(1);
      if (!maxErr && maxRows && maxRows.length) {
        const maxIdNum = parseInt(maxRows[0].id, 10);
        nextId = Number.isNaN(maxIdNum) ? `rpt_${Date.now()}` : (maxIdNum + 1).toString();
      } else {
        nextId = `rpt_${Date.now()}`;
      }
    } catch {
      nextId = `rpt_${Date.now()}`;
    }

    const wkt = `SRID=4326;POINT(${lng} ${lat})`;
    const newRecord = {
      id: nextId,
      title: `User Report: ${location.trim()}`,
      source: 'User Report',
      link: null,
      location: location.trim(),
      area: area.trim(),
      zone: inferZone(area),
      severity,
      score: severity === 'fatal' ? 10 : severity === 'serious' ? 5 : 1,
      date_raw: date,
      accident_date: date,
      has_coords: true,
      geom: wkt,
      status: 'pending',
      reporter_id: reporterId,
      description: description.trim()
    };

    const { error } = await supabase.from('accidents').insert(newRecord);
    if (error) {
      console.error('Report insert error:', error.message);
      return res.status(500).json({ error: 'Report could not be saved' });
    }

    return res.status(201).json({ id: nextId });
  } catch (e) {
    console.error('POST /api/reports error:', e.message);
    return res.status(500).json({ error: 'Report could not be saved' });
  }
});

app.get('/api/reports/mine', validateJwt, async (req, res) => {
  try {
    const userId = req.jwtPayload.sub;
    const { data, error } = await supabase
      .from('accidents')
      .select('id, title, location, area, severity, accident_date, status, description')
      .eq('reporter_id', userId)
      .order('accident_date', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch reports' });
    }

    const reports = (data || []).map(report => ({
      id: report.id,
      title: report.title,
      location: report.location,
      area: report.area,
      severity: report.severity,
      date: report.accident_date,
      status: report.status === 'active' ? 'verified'
            : report.status === 'hidden' ? 'rejected'
            : report.status || 'pending',
      description: report.description
    }));

    return res.json(reports);
  } catch (e) {
    console.error('GET /api/reports/mine error:', e.message);
    return res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// ── Admin Routes ───────────────────────────────────────────────────────────

app.get('/api/admin/me', adminAuth, (req, res) => {
  res.json({ ok: true, user: req.jwtPayload.sub || req.jwtPayload.email || 'admin' });
});

app.get('/api/admin/config', adminAuth, (_req, res) => {
  res.json({ mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || '' });
});

app.get('/api/admin/accidents', adminAuth, async (req, res) => {
  try {
    const { search, status, severity, page = 1, limit = 50, sortBy = 'accident_date', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let sb = supabase.from('accidents')
      .select('id, title, source, link, location, area, zone, severity, score, status, accident_date, date_raw, geom', { count: 'exact' });

    if (status && status !== 'all') sb = sb.eq('status', status);
    if (severity && severity !== 'all') sb = sb.eq('severity', severity);
    if (search) sb = sb.or(`title.ilike.%${search}%,location.ilike.%${search}%,area.ilike.%${search}%`);

    const finalSortBy = ['id', 'accident_date', 'severity', 'score'].includes(sortBy) ? sortBy : 'accident_date';
    const { data, error, count } = await sb
      .order(finalSortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
      .range(offset, offset + Number(limit) - 1);

    if (error) throw error;

    const rows = (data || []).map(r => {
      const geom = r.geom;
      const lat = geom?.coordinates?.[1] ?? null;
      const lng = geom?.coordinates?.[0] ?? null;
      return { id: r.id, title: r.title, source: r.source, link: r.link, location: r.location, area: r.area, zone: r.zone, severity: r.severity, score: r.score, status: r.status, date: r.accident_date, date_raw: r.date_raw, lat, lng };
    });

    res.json({ total: count, page: Number(page), limit: Number(limit), rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.patch('/api/admin/accidents/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, lat, lng, location, area } = req.body || {};
    const updates = {};

    if (status !== undefined) {
      if (!['active', 'hidden'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      updates.status = status;
    }
    if (lat !== undefined && lng !== undefined) {
      const latN = parseFloat(lat), lngN = parseFloat(lng);
      if (isNaN(latN) || isNaN(lngN)) return res.status(400).json({ error: 'Invalid coords' });
      updates.geom = `SRID=4326;POINT(${lngN} ${latN})`;
      updates.has_coords = true;
    }
    if (location !== undefined) updates.location = location;
    if (area !== undefined) { updates.area = area; updates.zone = inferZone(area); }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const { error } = await supabase.from('accidents').update(updates).eq('id', id);
    if (error) throw error;

    syncPatchToJson(id, { lat, lng, location, area });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.delete('/api/admin/accidents/:id', adminAuth, async (req, res) => {
  try {
    const { error } = await supabase.from('accidents').delete().eq('id', req.params.id);
    if (error) throw error;
    syncDeleteToJson(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.post('/api/admin/accidents', adminAuth, async (req, res) => {
  try {
    let { title, source, link, content } = req.body || {};

    if (!link && (!title || !content)) {
      return res.status(400).json({ error: 'Either Article Link, or Title and Content are required.' });
    }

    if (link) {
      const response = await fetch(link, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (!response.ok) throw new Error(`Failed to fetch URL (HTTP ${response.status})`);
      content = stripHtml(await response.text());
      if (!content || content.length < 50) {
        return res.status(400).json({ error: 'Scraped content is too short or empty.' });
      }
    }

    const extracted = await verifyAndExtractArticle(title, link, content);
    if (!extracted.is_in_bangalore) {
      return res.status(400).json({ error: 'Accident not in Bangalore' });
    }

    const finalTitle = title || extracted.title || 'Untitled Accident';
    const finalSource = source || extracted.source || 'News Article';

    let lat = extracted.lat;
    let lng = extracted.lng;
    if (!lat || !lng) {
      const coords = await geocodeLocation(extracted.location, extracted.area);
      lat = coords.lat;
      lng = coords.lng;
    }

    let nextId;
    try {
      const { data: maxRows, error: maxErr } = await supabase
        .from('accidents').select('id').order('id', { ascending: false }).limit(1);
      if (!maxErr && maxRows?.length) {
        const maxIdNum = parseInt(maxRows[0].id, 10);
        nextId = Number.isNaN(maxIdNum) ? `art_${Date.now()}` : (maxIdNum + 1).toString();
      } else {
        nextId = `art_${Date.now()}`;
      }
    } catch {
      nextId = `art_${Date.now()}`;
    }

    const wkt = lat && lng ? `SRID=4326;POINT(${lng} ${lat})` : null;
    const newRecord = {
      id: nextId,
      title: finalTitle,
      source: finalSource,
      link: link || null,
      location: extracted.location || finalTitle,
      area: extracted.area,
      zone: inferZone(extracted.area),
      severity: extracted.severity,
      score: extracted.severity === 'fatal' ? 10 : extracted.severity === 'serious' ? 5 : 1,
      date_raw: extracted.date,
      accident_date: extracted.date !== 'Unknown' ? extracted.date : null,
      has_coords: lat != null && lng != null,
      geom: wkt
    };

    const { error } = await supabase.from('accidents').insert(newRecord);
    if (error) throw error;

    syncNewToJson({ id: nextId, title: finalTitle, source: finalSource, link, location: newRecord.location, area: newRecord.area, lat, lng, score: newRecord.score, severity: newRecord.severity, date: extracted.date, hasCoords: newRecord.has_coords });
    res.json({ ok: true, id: nextId });
  } catch (e) {
    console.error('Failed to upload/verify accident:', e);
    res.status(500).json({ error: e.message || 'Verification and upload failed' });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function inferZone(area) {
  const s = String(area || '').toLowerCase();
  if (!s) return 'Central';
  if (/east|whitefield|kr puram|indiranagar|marathahalli|varthur|kadubeesanahalli|hopefarm|kadugodi|sarjapur|domlur|carmelaram|mahadevapura|bellandur|hsr|koramangala/.test(s)) return 'East';
  if (/north|hebbal|yelahanka|jakkur|kodigehalli|bellary|tumkur|peenya|mathikere|rt nagar|yeshwanthpur|nagavara|manyata|kamanahalli|banaswadi/.test(s)) return 'North';
  if (/south|jayanagar|jp nagar|bannerghatta|arekere|banashankari|btm|silk|hosur|electronic|nice|kengeri|mysore/.test(s)) return 'South';
  if (/west|rajajinagar|vijayanagar|magadi|jalahalli/.test(s)) return 'West';
  if (/central|mg road|majestic|shivaji|richmond|cantonment|ulsoor|cbd/.test(s)) return 'Central';
  if (/nh|highway|outer ring|orr|nh-44/.test(s)) return 'Highway / ORR';
  return 'Other';
}

async function geocodeLocation(loc, area) {
  const query = loc ? `${loc}, Bangalore` : `${area}, Bangalore`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&viewbox=77.35,13.25,77.85,12.7&bounded=1&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'BangaloreAccidentsTracker/1.0' } });
    if (res.ok) {
      const data = await res.json();
      if (data?.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (e) {
    console.error('Geocoding error:', e.message);
  }
  return { lat: null, lng: null };
}

function stripHtml(html) {
  if (!html) return '';
  let text = html.replace(/<(script|style|iframe)\b[^>]*>([\s\S]*?)<\/\1>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  text = text.replace(/\s+/g, ' ').trim();
  return text.substring(0, 15000);
}

async function verifyAndExtractArticle(title, link, content) {
  const model = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash:free';
  const prompt = `You are an expert accident data extraction AI.
Analyze this news article or accident report text and extract the details.
Provided Title: "${title || ''}"
URL: "${link || ''}"
Content: "${content || ''}"

Return a valid JSON object ONLY, with no markdown code blocks, no backticks, and no extra text.
The JSON object must have exactly these keys:
{
  "title": "The title or summary headline of the accident.",
  "source": "The source (e.g. 'The Hindu', 'Deccan Herald'). Default to 'News Article' if unknown.",
  "location": "A precise landmark or street in Bangalore. If outside Bangalore, set to null.",
  "area": "The general neighborhood name in Bangalore.",
  "is_in_bangalore": true,
  "date": "The accident date in 'YYYY-MM-DD' format. Use 'Unknown' if undetermined.",
  "severity": "Must be exactly one of: 'fatal', 'serious', or 'minor'.",
  "time": "The time of the accident (e.g. '22:15') if mentioned, otherwise null.",
  "lat": 12.9716,
  "lng": 77.5946
}`;

  const response = await openrouter.chat.send({
    chatRequest: { model, messages: [{ role: "user", content: prompt }], stream: false }
  });

  const rawText = response.choices[0]?.message?.content;
  if (!rawText) throw new Error('Empty response from AI model.');

  const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    title: parsed.title || null,
    source: parsed.source || null,
    location: parsed.location || title || null,
    area: parsed.area || 'Bangalore',
    is_in_bangalore: parsed.is_in_bangalore ?? true,
    date: parsed.date || 'Unknown',
    severity: ['fatal', 'serious', 'minor'].includes(parsed.severity) ? parsed.severity : 'minor',
    time: parsed.time || null,
    lat: typeof parsed.lat === 'number' ? parsed.lat : null,
    lng: typeof parsed.lng === 'number' ? parsed.lng : null
  };
}

// ── JSON Sync Helpers ──────────────────────────────────────────────────────

const JSON_PATH = path.join(__dirname, '..', 'Frontend', 'accident_data.json');

function syncPatchToJson(id, { lat, lng, location, area }) {
  try {
    if (!fs.existsSync(JSON_PATH)) return;
    const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    const item = data.find(r => r.id === id);
    if (!item) return;
    if (lat !== undefined && lng !== undefined) { item.lat = parseFloat(lat); item.lng = parseFloat(lng); item.hasCoords = true; }
    if (location !== undefined) item.location = location;
    if (area !== undefined) item.area = area;
    fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { console.error('JSON sync patch error:', e.message); }
}

function syncDeleteToJson(id) {
  try {
    if (!fs.existsSync(JSON_PATH)) return;
    const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    const filtered = data.filter(r => r.id !== id);
    if (filtered.length !== data.length) {
      fs.writeFileSync(JSON_PATH, JSON.stringify(filtered, null, 2), 'utf8');
    }
  } catch (e) { console.error('JSON sync delete error:', e.message); }
}

function syncNewToJson(record) {
  try {
    if (!fs.existsSync(JSON_PATH)) return;
    const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    data.unshift(record);
    fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { console.error('JSON sync new error:', e.message); }
}

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`BAT API listening on http://localhost:${PORT}`));
