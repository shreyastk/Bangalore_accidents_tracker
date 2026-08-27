import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set SUPABASE_DATABASE_URL (recommended) or DATABASE_URL before seeding.');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10000 });

const dataPath = path.join(__dirname, '..', 'Database', 'accident_data.json');
const records = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

function mapSeverity(score) {
  const s = Number(score);
  if (s >= 6) return 'fatal';
  if (s >= 3) return 'serious';
  return 'minor';
}

function validDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

async function main() {
  console.log(`Loading ${records.length} accident records from ${dataPath}...`);
  let inserted = 0, skipped = 0;
  for (const r of records) {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (r.latitude == null || r.longitude == null || isNaN(lat) || isNaN(lng)) { skipped++; continue; }
    if (lat < 12.5 || lat > 13.5 || lng < 77.0 || lng > 78.2) { skipped++; continue; }

    const id = String(r.id);
    const severity = mapSeverity(r.severity);
    const score = Math.min(10, Math.max(1, Number(r.severity) || 1));
    const date = validDate(r.date);
    const wkt = `SRID=4326;POINT(${lng} ${lat})`;

    try {
      await pool.query(
        `INSERT INTO accidents (id, title, source, link, location, area, zone, severity, score, date_raw, accident_date, has_coords, geom, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12::geometry, 'active')
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, source = EXCLUDED.source, link = EXCLUDED.link,
           location = EXCLUDED.location, area = EXCLUDED.area, zone = EXCLUDED.zone,
           severity = EXCLUDED.severity, score = EXCLUDED.score,
           date_raw = EXCLUDED.date_raw, accident_date = EXCLUDED.accident_date,
           has_coords = TRUE, geom = EXCLUDED.geom, status = 'active'`,
        [id, r.title, r.source_link || null, r.source_link || null, r.location, r.location || r.title, r.zone || null, severity, score, date, date, wkt]
      );
      inserted++;
    } catch (e) {
      console.error('insert error for', id, ':', e.message);
      skipped++;
    }
  }
  console.log(`Done. inserted/updated: ${inserted}, skipped: ${skipped}`);
  await pool.end();
}

main().catch(e => { console.error('Seed failed:', e); process.exit(1); });
