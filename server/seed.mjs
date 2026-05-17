import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.join(__dirname, '..', '.env');
const serverEnv = path.join(__dirname, '.env');
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
if (fs.existsSync(serverEnv)) dotenv.config({ path: serverEnv, override: true });
/** Run `npm run import:xlsx` first so this matches Database/Bangalore Accidents Tracker.xlsx */
const jsonPath = path.join(__dirname, '..', 'Frontend', 'accident_data.json');

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

function parseDate(raw) {
  if (!raw || raw === 'Unknown') return { dateRaw: raw || null, accidentDate: null };
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { dateRaw: raw, accidentDate: null };
  return { dateRaw: raw, accidentDate: `${m[1]}-${m[2]}-${m[3]}` };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Set DATABASE_URL in server/.env');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  await client.query('BEGIN');
  await client.query('DELETE FROM accidents');

  let n = 0;
  for (const row of raw) {
    if (!row.hasCoords || row.lat == null || row.lng == null) continue;
    const sev = row.severity;
    if (!['fatal', 'serious', 'minor'].includes(sev)) continue;
    const { dateRaw, accidentDate } = parseDate(row.date);
    const zone = inferZone(row.area);
    await client.query(
      `INSERT INTO accidents (id, title, source, link, location, area, zone, severity, score, date_raw, accident_date, has_coords, geom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true, ST_SetSRID(ST_MakePoint($12,$13),4326))`,
      [
        row.id,
        row.title,
        row.source || null,
        row.link || null,
        row.location || null,
        row.area || null,
        zone,
        sev,
        row.score ?? null,
        dateRaw,
        accidentDate,
        Number(row.lng),
        Number(row.lat),
      ]
    );
    n++;
  }

  await client.query('COMMIT');
  await client.end();
  console.log(`Seeded ${n} rows from ${jsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
