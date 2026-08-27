import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set SUPABASE_DATABASE_URL (recommended) or DATABASE_URL before seeding.');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10000 });

async function fetchHospitalsOverpass() {
  const bbox = '12.5,77.0,13.5,78.2';
  const query = `[
 out:json][timeout:60];
(node["amenity"="hospital"](${bbox});
 way["amenity"="hospital"](${bbox});
 rel["amenity"="hospital"](${bbox});
);
out center;`;
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.osm.ch/api/interpreter'
  ];
  let lastErr = null;
  for (const base of mirrors) {
    try {
      const res = await fetch(base, { method: 'POST', body: query });
      if (res.ok) return await res.json();
      lastErr = new Error(`Overpass HTTP ${res.status} (${base})`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function normalizeFeature(f) {
  const tags = f.tags || {};
  const name = tags.name || tags['official_name'] || null;
  const phone = tags.phone || tags['contact:phone'] || tags['telephone'] || null;
  const address = [tags['addr:street'], tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ') || tags['addr:full'] || null;
  let lat = null, lon = null;
  if (f.lat && f.lon) { lat = f.lat; lon = f.lon; }
  else if (f.center && f.center.lat && f.center.lon) { lat = f.center.lat; lon = f.center.lon; }
  return { name, phone, address, lat, lon };
}

async function seed() {
  console.log('Fetching hospitals from Overpass...');
  const data = await fetchHospitalsOverpass();
  const elements = data.elements || [];
  console.log(`Found ${elements.length} elements`);

  const rows = [];
  for (const el of elements) {
    const n = normalizeFeature(el);
    if (!n.name || !n.lat || !n.lon) continue;
    const id = 'hosp_' + Buffer.from((n.name + '|' + n.lat + '|' + n.lon)).toString('base64url').slice(0,20);
    rows.push({ id, name: n.name, phone: n.phone, address: n.address, location: `SRID=4326;POINT(${n.lon} ${n.lat})` });
  }

  console.log(`Inserting ${rows.length} hospitals into Postgres`);
  for (const r of rows) {
    try {
      await pool.query(
        `INSERT INTO hospitals (id, name, phone, address, location)
         VALUES ($1, $2, $3, $4, $5::geography)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, address = EXCLUDED.address, location = EXCLUDED.location`,
        [r.id, r.name, r.phone, r.address, r.location]
      );
    } catch (err) {
      console.error('Insert error for', r.name, err.message);
    }
  }
  await pool.end();

  // Optionally save to a local file for inspection
  try { fs.writeFileSync(path.join(__dirname, 'seed-hospitals.json'), JSON.stringify(rows, null, 2)); } catch (e) {}
  console.log('Seeding complete');
}

seed().catch(e => { console.error('Seeding failed:', e); process.exit(1); });
