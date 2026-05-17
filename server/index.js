import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.join(__dirname, '..', '.env');
const serverEnv = path.join(__dirname, '.env');
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
if (fs.existsSync(serverEnv)) dotenv.config({ path: serverEnv, override: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('\n[!] DATABASE_URL is not set.\n');
  process.exit(1);
}

const ADMIN_USER   = process.env.ADMIN_USER   || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASS   || 'bat@admin2024';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'bat-secret-token-xyz987';

// Supabase client initialization
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);


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

// Supabase Auth middleware
async function supabaseAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.__token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  req.supabaseUser = user;
  next();
}

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ user, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// ── Public routes ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

function buildWhere(query, extra = []) {
  const { from, to, severity, area, zone } = query;
  const cond = ['geom IS NOT NULL', 'status = \'active\'', ...extra];
  const params = [];
  let i = 1;
  if (from)                              { cond.push(`accident_date >= $${i}::date`); params.push(from); i++; }
  if (to)                                { cond.push(`accident_date <= $${i}::date`); params.push(to);   i++; }
  if (severity && severity !== 'all')    { cond.push(`severity = $${i}`);             params.push(severity); i++; }
  if (area     && area     !== 'all')    { cond.push(`area = $${i}`);                 params.push(area);     i++; }
  if (zone     && zone     !== 'all')    { cond.push(`zone = $${i}`);                 params.push(zone);     i++; }
  return { whereSql: `WHERE ${cond.join(' AND ')}`, params };
}

app.get('/api/accidents', async (req, res) => {
  try {
    const { whereSql, params } = buildWhere(req.query);
    const sql = `
      SELECT json_build_object(
        'type','FeatureCollection',
        'features', COALESCE((
          SELECT json_agg(json_build_object(
            'type','Feature',
            'geometry', ST_AsGeoJSON(geom)::json,
            'properties', json_build_object(
              'id',id,'title',title,'source',source,'link',link,
              'location',location,'area',area,'zone',zone,'severity',severity,
              'score',score,'date',COALESCE(accident_date::text,date_raw),'date_raw',date_raw
            )
          ))
          FROM accidents ${whereSql}
        ),'[]'::json)
      ) AS fc`;
    const { data: rows, error } = await supabase.rpc('run_sql', { sql, params });
  if (error) throw error;
    res.json(rows[0].fc);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.get('/api/meta', async (_req, res) => {
  try {
    const { data: areaRows, error: areaErr } = await supabase.from('accidents').select('area').neq('area', null);
    const { data: zoneRows, error: zoneErr } = await supabase.from('accidents').select('zone').neq('zone', null);
    const areas = areaRows ? Array.from(new Set(areaRows.map(r => r.area))).filter(Boolean) : [];
    const zones = zoneRows ? Array.from(new Set(zoneRows.map(r => r.zone))).filter(Boolean) : [];
    // Counts: fallback to raw query using supabase.rpc (function must exist)
    const { data: countsData, error: countsErr } = await supabase.rpc('run_sql', { sql: `
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER(WHERE severity='fatal')::int   AS fatal,
        COUNT(*) FILTER(WHERE severity='serious')::int AS serious,
        COUNT(*) FILTER(WHERE severity='minor')::int   AS minor
      FROM accidents WHERE geom IS NOT NULL AND status='active'` });
    const counts = countsData ? countsData[0] : {};
    res.json({ areas, zones, counts });
  } catch (e) {
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

app.get('/api/admin/me', supabaseAuth, (req, res) => {
  res.json({ ok: true, user: ADMIN_USER });
});

// ── Admin CRUD ─────────────────────────────────────────────────────────────

/** GET /api/admin/accidents — all records with all fields */
app.get('/api/admin/accidents', supabaseAuth, async (req, res) => {
  try {
    const { search, status, severity, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);


    // Build Supabase query with filters
    let sb = supabase.from('accidents')
      .select(`id, title, source, link, location, area, zone, severity, score, status, accident_date, date_raw, geom`, { count: 'exact' });
    if (status && status !== 'all') sb = sb.eq('status', status);
    if (severity && severity !== 'all') sb = sb.eq('severity', severity);
    if (search) sb = sb.or(`title.ilike.%${search}%,location.ilike.%${search}%,area.ilike.%${search}%`);
    const { data, error, count } = await sb
      .order('accident_date', { ascending: false })
      .range(offset, offset + Number(limit) - 1);
    if (error) throw error;
    // Transform geometry to lat/lng and date formatting
    const rows = data ? data.map(r => ({
      id: r.id,
      title: r.title,
      source: r.source,
      link: r.link,
      location: r.location,
      area: r.area,
      zone: r.zone,
      severity: r.severity,
      score: r.score,
      status: r.status,
      date: r.accident_date ? r.accident_date : null,
      date_raw: r.date_raw,
      lat: r.geom ? parseFloat(r.geom.coordinates[1].toFixed(6)) : null,
      lng: r.geom ? parseFloat(r.geom.coordinates[0].toFixed(6)) : null,
      has_coords: !!r.geom
    })) : [];
    res.json({ total: count, page: Number(page), limit: Number(limit), rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

/** PATCH /api/admin/accidents/:id — update status and/or coordinates */
app.patch('/api/admin/accidents/:id', supabaseAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, lat, lng } = req.body || {};

    // Build update payload
    const updates = {};
    if (status !== undefined) {
      if (!['active', 'hidden'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      updates.status = status;
    }
    if (lat !== undefined && lng !== undefined) {
      const latN = parseFloat(lat);
      const lngN = parseFloat(lng);
      if (isNaN(latN) || isNaN(lngN)) return res.status(400).json({ error: 'Invalid coords' });
      // Store as PostGIS point via Raw SQL RPC or as a geometry JSON; using RPC placeholder here
      updates.geom = `POINT(${lngN} ${latN})`;
    }
    const { data, error } = await supabase.from('accidents').update(updates).eq('id', id);
    if (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed', detail: error.message });
    }
    if (!data || data.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

/** DELETE /api/admin/accidents/:id — permanently delete */
app.delete('/api/admin/accidents/:id', supabaseAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('accidents').delete().eq('id', req.params.id);
    if (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed', detail: error.message });
    }
    if (!data || data.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.listen(PORT, () => console.log(`BAT API listening on http://localhost:${PORT}`));
