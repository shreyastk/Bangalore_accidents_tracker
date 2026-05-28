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

const ADMIN_USER   = process.env.ADMIN_USER   || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASS   || 'bat@admin2024';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'bat-secret-token-xyz987';

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

app.get('/api/admin/config', adminAuth, (_req, res) => {
  res.json({ mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || '' });
});

// ── Admin CRUD ─────────────────────────────────────────────────────────────

app.get('/api/admin/accidents', adminAuth, async (req, res) => {
  try {
    const { search, status, severity, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let sb = supabase.from('accidents')
      .select('id, title, source, link, location, area, zone, severity, score, status, accident_date, date_raw, geom', { count: 'exact' });

    if (status   && status   !== 'all') sb = sb.eq('status',   status);
    if (severity && severity !== 'all') sb = sb.eq('severity', severity);
    if (search) sb = sb.or(`title.ilike.%${search}%,location.ilike.%${search}%,area.ilike.%${search}%`);

    const { data, error, count } = await sb
      .order('accident_date', { ascending: false, nullsFirst: false })
      .range(offset, offset + Number(limit) - 1);

    if (error) throw error;

    const rows = (data || []).map(r => {
      const geom = r.geom;
      const lat = geom && geom.coordinates ? geom.coordinates[1] : null;
      const lng = geom && geom.coordinates ? geom.coordinates[0] : null;
      return {
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
        accident_date: r.accident_date,
        date_raw: r.date_raw,
        lat,
        lng
      };
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

    // Sync updates to Frontend/accident_data.json
    if (lat !== undefined && lng !== undefined) {
      try {
        const jsonPath = path.join(__dirname, '..', 'Frontend', 'accident_data.json');
        if (fs.existsSync(jsonPath)) {
          const fileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          const item = fileData.find(r => r.id === id);
          if (item) {
            item.lat = parseFloat(lat);
            item.lng = parseFloat(lng);
            item.hasCoords = true;
            fs.writeFileSync(jsonPath, JSON.stringify(fileData, null, 2), 'utf8');
            console.log(`Synced coordinates patch to accident_data.json for ID ${id}`);
          }
        }
      } catch (err) {
        console.error(`Failed to sync patch to JSON:`, err.message);
      }
    }

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

    // Sync delete to Frontend/accident_data.json
    try {
      const jsonPath = path.join(__dirname, '..', 'Frontend', 'accident_data.json');
      if (fs.existsSync(jsonPath)) {
        const fileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const filtered = fileData.filter(r => r.id !== req.params.id);
        if (filtered.length !== fileData.length) {
          fs.writeFileSync(jsonPath, JSON.stringify(filtered, null, 2), 'utf8');
          console.log(`Synced deletion to accident_data.json for ID ${req.params.id}`);
        }
      }
    } catch (err) {
      console.error(`Failed to sync deletion to JSON:`, err.message);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed', detail: e.message });
  }
});

function inferZone(area) {
  const s = String(area || '').toLowerCase();
  if (!s) return 'Central';
  if (
    /east|whitefield|kr puram|indiranagar|marathahalli|varthur|kadubeesanahalli|hopefarm|kadugodi|sarjapur|domlur|carmelaram|mahadevapura|bellandur|hsr|koramangala/.test(
      s
    )
  )
    return 'East';
  if (
    /north|hebbal|yelahanka|jakkur|kodigehalli|bellary|tumkur|peenya|mathikere|rt nagar|yeshwanthpur|nagavara|manyata|kamanahalli|banaswadi/.test(
      s
    )
  )
    return 'North';
  if (
    /south|jayanagar|jp nagar|bannerghatta|arekere|banashankari|btm|silk|hosur|electronic|nice|kengeri|mysore/.test(
      s
    )
  )
    return 'South';
  if (/west|rajajinagar|vijayanagar|magadi|jalahalli/.test(s)) return 'West';
  if (/central|mg road|majestic|shivaji|richmond|cantonment|ulsoor|cbd/.test(s)) return 'Central';
  if (/nh|highway|outer ring|orr|nh-44|highway/.test(s)) return 'Highway / ORR';
  return 'Other';
}

async function geocodeLocation(loc, area) {
  const viewbox = '77.35,13.25,77.85,12.7';
  const query = loc ? `${loc}, Bangalore` : `${area}, Bangalore`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&viewbox=${viewbox}&bounded=1&format=json&limit=1`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
      }
    }
  } catch (e) {
    console.error('Nominatim geocoding error:', e.message);
  }
  return { lat: null, lng: null };
}

function stripHtml(html) {
  if (!html) return '';
  // Remove script, style, and iframe tags and their contents
  let text = html.replace(/<(script|style|iframe)\b[^>]*>([\s\S]*?)<\/\1>/gi, '');
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '-');
  // Collapse multiple whitespaces and newlines
  text = text.replace(/\s+/g, ' ').trim();
  // Limit character length to prevent token limit issues
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
  "title": "The title of the news article or a summary headline of the accident if the provided title is empty. Keep it clean and descriptive.",
  "source": "The source of the news article (e.g. 'The Hindu', 'Deccan Herald', 'Times of India', or the domain name if unknown). Default to 'News Article' if unknown.",
  "location": "A precise landmark, street, or intersection in Bangalore (e.g. 'Richmond Road flyover', 'Kogilu junction on Bellary Road'). If outside Bangalore, set to null.",
  "area": "The general neighborhood name in Bangalore (e.g. 'HSR Layout', 'Hebbal', 'Indiranagar', 'KR Puram', 'Electronic City', 'Yeshwanthpur', 'BTM Layout'). Choose one of these or similar major Bangalore areas.",
  "is_in_bangalore": true,
  "date": "The accident date in ISO format 'YYYY-MM-DD'. If not explicitly mentioned, try to estimate relative to the publication info or context. Use 'Unknown' if you cannot determine it.",
  "severity": "Must be exactly one of: 'fatal' (if someone died/killed), 'serious' (if severe injuries), or 'minor' (minor injuries or general traffic announcements). Default to 'minor' if unsure.",
  "time": "The time of the accident (e.g. '22:15' or '03:30') if mentioned, otherwise null.",
  "lat": 12.9716, // A number representing the estimated latitude of the accident location in Bangalore (must be between 12.7 and 13.25). You must estimate this coordinate based on the location landmark name, even if approximate. Do not leave this null under any circumstance if the location is in Bangalore.
  "lng": 77.5946  // A number representing the estimated longitude of the accident location in Bangalore (must be between 77.35 and 77.85). You must estimate this coordinate based on the location landmark name, even if approximate. Do not leave this null under any circumstance if the location is in Bangalore.
}`;

  try {
    const response = await openrouter.chat.send({
      chatRequest: {
        model: model,
        messages: [{ role: "user", content: prompt }],
        stream: false
      }
    });

    console.log('OpenRouter Response:', JSON.stringify(response, null, 2));
    const rawText = response.choices[0]?.message?.content;
    if (!rawText) throw new Error('Empty response from DeepSeek model.');

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
  } catch (e) {
    if (e.statusCode === 429 || (e.message && e.message.includes('rate-limited'))) {
      throw new Error('DeepSeek model is temporarily rate-limited upstream. Please retry in a few moments.');
    }
    throw e;
  }
}

app.post('/api/admin/accidents', adminAuth, async (req, res) => {
  try {
    let { title, source, link, content } = req.body || {};
    
    if (!link && (!title || !content)) {
      return res.status(400).json({ error: 'Either Article Link, or Title and Content are required.' });
    }

    if (link) {
      console.log(`Fetching and scraping URL: ${link}`);
      try {
        const response = await fetch(link, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch URL (HTTP status ${response.status})`);
        }
        const html = await response.text();
        content = stripHtml(html);
        if (!content || content.length < 50) {
          throw new Error('Scraped content is too short or empty. Please check the URL.');
        }
        console.log(`Scraped content length: ${content.length} chars. Preview: ${content.substring(0, 100)}...`);
      } catch (scrapeErr) {
        console.error('Scraping failed:', scrapeErr.message);
        return res.status(400).json({ error: `Failed to scrape news article from link: ${scrapeErr.message}` });
      }
    }

    console.log(`Starting DeepSeek verification for: "${title || link}"`);
    
    // 1. LLM Verification & Extraction
    const extracted = await verifyAndExtractArticle(title, link, content);
    if (!extracted.is_in_bangalore) {
      return res.status(400).json({ error: 'Accident not in Bangalore' });
    }
    console.log('LLM Extracted:', extracted);

    const finalTitle = title || extracted.title || 'Untitled Accident';
    const finalSource = source || extracted.source || 'News Article';

    // 2. Geocoding: Use LLM-extracted coordinates, fall back to Nominatim if missing/invalid
    let lat = extracted.lat;
    let lng = extracted.lng;
    
    if (!lat || !lng) {
      console.log('LLM coordinates missing/invalid. Falling back to Nominatim geocoding...');
      const coords = await geocodeLocation(extracted.location, extracted.area);
      lat = coords.lat;
      lng = coords.lng;
      console.log('Geocoding fallback result:', coords);
    } else {
      console.log('Using LLM-extracted coordinates:', { lat, lng });
    }

    // 3. Save to Supabase
    // Compute next numeric ID based on current max ID in the table
    let nextId;
    try {
      const { data: maxRows, error: maxErr } = await supabase
        .from('accidents')
        .select('id')
        .order('id', { ascending: false })
        .limit(1);
      if (!maxErr && maxRows && maxRows.length) {
        const maxIdStr = maxRows[0].id;
        const maxIdNum = parseInt(maxIdStr, 10);
        nextId = Number.isNaN(maxIdNum) ? `art_${Date.now()}` : (maxIdNum + 1).toString();
      } else {
        nextId = `art_${Date.now()}`;
      }
    } catch (e) {
      console.error('Failed to compute next ID:', e);
      nextId = `art_${Date.now()}`;
    }
    const id = nextId;
    const wkt = lat && lng ? `SRID=4326;POINT(${lng} ${lat})` : null;
    const has_coords = lat != null && lng != null;

    const newRecord = {
      id,
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
      has_coords,
      geom: wkt
    };

    const { error } = await supabase.from('accidents').insert(newRecord);
    if (error) throw error;

    // 4. Sync to Frontend/accident_data.json
    try {
      const jsonPath = path.join(__dirname, '..', 'Frontend', 'accident_data.json');
      if (fs.existsSync(jsonPath)) {
        const fileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const clientRecord = {
          id,
          title: finalTitle,
          source: finalSource,
          link: newRecord.link,
          location: newRecord.location,
          area: newRecord.area,
          lat,
          lng,
          score: newRecord.score,
          severity: newRecord.severity,
          date: extracted.date,
          hasCoords: has_coords
        };
        fileData.unshift(clientRecord); // add to beginning
        fs.writeFileSync(jsonPath, JSON.stringify(fileData, null, 2), 'utf8');
        console.log(`Synced new accident to accident_data.json for ID ${id}`);
      }
    } catch (err) {
      console.error(`Failed to sync upload to JSON:`, err.message);
    }

    res.json({ ok: true, id });
  } catch (e) {
    console.error('Failed to upload/verify accident:', e);
    res.status(500).json({ error: e.message || 'Verification and upload failed' });
  }
});

app.listen(PORT, () => console.log(`BAT API listening on http://localhost:${PORT}`));
