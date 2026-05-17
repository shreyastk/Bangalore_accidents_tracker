import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const ADMIN_USER   = process.env.ADMIN_USER   || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASS   || 'bat@admin2024';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'bat-secret-token-xyz987';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app  = express();
const PORT = Number(process.env.PORT || 3000);

const corsOrigin = process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = corsOrigin?.length ? [...corsOrigin, 'null'] : true;
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Serve Frontend static files
const frontendDir = path.join(__dirname, '..', 'Frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
  console.log(`Serving Frontend at http://localhost:${PORT}/dashboard.html`);
}

// ── HMAC Token Auth ────────────────────────────────────────────────────────

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ user, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - data.ts > 12 * 3600 * 1000) return null;
    return data;
  } catch { return null; }
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.__token;
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Public routes ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /api/accidents — returns GeoJSON FeatureCollection via Supabase RPC
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

// GET /api/meta — areas, zones, counts
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

// ── Admin auth ─────────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: makeToken(username), user: username });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/admin/me', adminAuth, (_req, res) => {
  res.json({ ok: true, user: ADMIN_USER });
});

// ── Admin CRUD ─────────────────────────────────────────────────────────────

app.get('/api/admin/accidents', adminAuth, async (req, res) => {
  try {
    const { search, status, severity, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let sb = supabase.from('accidents')
      .select('id, title, source, link, location, area, zone, severity, score, status, accident_date, date_raw', { count: 'exact' });

    if (status   && status   !== 'all') sb = sb.eq('status',   status);
    if (severity && severity !== 'all') sb = sb.eq('severity', severity);
    if (search) sb = sb.or(`title.ilike.%${search}%,location.ilike.%${search}%,area.ilike.%${search}%`);

    const { data, error, count } = await sb
      .order('accident_date', { ascending: false, nullsFirst: false })
      .range(offset, offset + Number(limit) - 1);

    if (error) throw error;
    res.json({ total: count, page: Number(page), limit: Number(limit), rows: data || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.patch('/api/admin/accidents/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, lat, lng } = req.body || {};
    const updates = {};

    if (status !== undefined) {
      if (!['active', 'hidden'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      updates.status = status;
    }
    if (lat !== undefined && lng !== undefined) {
      const latN = parseFloat(lat), lngN = parseFloat(lng);
      if (isNaN(latN) || isNaN(lngN)) return res.status(400).json({ error: 'Invalid coords' });
      updates.geom     = `SRID=4326;POINT(${lngN} ${latN})`;
      updates.has_coords = true;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const { error } = await supabase.from('accidents').update(updates).eq('id', id);
    if (error) throw error;
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
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.listen(PORT, () => console.log(`BAT API listening on http://localhost:${PORT}`));
