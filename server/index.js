import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import pg from 'pg';

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

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });

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

// ── Simple token auth ──────────────────────────────────────────────────────

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
    // Token valid for 12 hours
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
    const { rows } = await pool.query(sql, params);
    res.json(rows[0].fc);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.get('/api/meta', async (_req, res) => {
  try {
    const areas  = await pool.query(`SELECT DISTINCT area FROM accidents WHERE area IS NOT NULL ORDER BY area`);
    const zones  = await pool.query(`SELECT DISTINCT zone FROM accidents WHERE zone IS NOT NULL ORDER BY zone`);
    const counts = await pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER(WHERE severity='fatal')::int   AS fatal,
        COUNT(*) FILTER(WHERE severity='serious')::int AS serious,
        COUNT(*) FILTER(WHERE severity='minor')::int   AS minor
      FROM accidents WHERE geom IS NOT NULL AND status='active'`);
    res.json({ areas: areas.rows.map(r => r.area), zones: zones.rows.map(r => r.zone), counts: counts.rows[0] });
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

app.get('/api/admin/me', adminAuth, (req, res) => {
  res.json({ ok: true, user: ADMIN_USER });
});

// ── Admin CRUD ─────────────────────────────────────────────────────────────

/** GET /api/admin/accidents — all records with all fields */
app.get('/api/admin/accidents', adminAuth, async (req, res) => {
  try {
    const { search, status, severity, page = 1, limit = 50 } = req.query;
    const cond = [];
    const params = [];
    let i = 1;

    if (status && status !== 'all') { cond.push(`status = $${i}`); params.push(status); i++; }
    if (severity && severity !== 'all') { cond.push(`severity = $${i}`); params.push(severity); i++; }
    if (search) {
      cond.push(`(title ILIKE $${i} OR location ILIKE $${i} OR area ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }

    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);

    const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM accidents ${where}`, params);
    const total = countRes.rows[0].n;

    const dataRes = await pool.query(`
      SELECT
        id, title, source, link, location, area, zone, severity, score, status,
        accident_date::text AS date, date_raw,
        ROUND(ST_Y(geom)::numeric, 6) AS lat,
        ROUND(ST_X(geom)::numeric, 6) AS lng,
        (geom IS NOT NULL) AS has_coords
      FROM accidents
      ${where}
      ORDER BY accident_date DESC NULLS LAST, id
      LIMIT $${i} OFFSET $${i+1}`,
      [...params, Number(limit), offset]
    );

    res.json({ total, page: Number(page), limit: Number(limit), rows: dataRes.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

/** PATCH /api/admin/accidents/:id — update status and/or coordinates */
app.patch('/api/admin/accidents/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, lat, lng } = req.body || {};
    const sets = [];
    const params = [];
    let i = 1;

    if (status !== undefined) {
      if (!['active', 'hidden'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      sets.push(`status = $${i}`); params.push(status); i++;
    }
    if (lat !== undefined && lng !== undefined) {
      const latN = parseFloat(lat);
      const lngN = parseFloat(lng);
      if (isNaN(latN) || isNaN(lngN)) return res.status(400).json({ error: 'Invalid coords' });
      sets.push(`geom = ST_SetSRID(ST_MakePoint($${i}, $${i+1}), 4326)`);
      params.push(lngN, latN); i += 2;
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(id);
    const { rowCount } = await pool.query(
      `UPDATE accidents SET ${sets.join(', ')} WHERE id = $${i}`, params
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

/** DELETE /api/admin/accidents/:id — permanently delete */
app.delete('/api/admin/accidents/:id', adminAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM accidents WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

app.listen(PORT, () => console.log(`BAT API listening on http://localhost:${PORT}`));
