/**
 * Reads Frontend/accident_data.json and inserts all records into Supabase.
 * Run: node import-to-supabase.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const JSON_PATH = path.join(__dirname, '..', 'Frontend', 'accident_data.json');

if (!fs.existsSync(JSON_PATH)) {
  console.error('❌ accident_data.json not found at:', JSON_PATH);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
console.log(`📂 Loaded ${raw.length} records from accident_data.json`);

// Map JSON rows → Supabase table columns
function inferZone(area) {
  const s = String(area || '').toLowerCase();
  if (/east|whitefield|kr puram|indiranagar|marathahalli|sarjapur|domlur|hsr|koramangala/.test(s)) return 'East';
  if (/north|hebbal|yelahanka|tumkur|peenya|mathikere|rt nagar|yeshwanthpur|nagavara/.test(s)) return 'North';
  if (/south|jayanagar|jp nagar|bannerghatta|btm|silk|hosur|electronic|kengeri|mysore/.test(s)) return 'South';
  if (/west|rajajinagar|vijayanagar|magadi|jalahalli/.test(s)) return 'West';
  if (/central|mg road|majestic|shivaji|cantonment/.test(s)) return 'Central';
  if (/nh|highway|outer ring|orr/.test(s)) return 'Highway / ORR';
  return 'Other';
}

const rows = raw
  .filter(r => r.hasCoords && r.lat != null && r.lng != null)
  .map(r => ({
    id:            String(r.id),
    title:         r.title || 'Untitled',
    source:        r.source || null,
    link:          r.link   || null,
    location:      r.location || null,
    area:          r.area   || 'Bangalore',
    zone:          inferZone(r.area),
    severity:      ['fatal','serious','minor'].includes(r.severity) ? r.severity : 'minor',
    score:         r.score  ?? 0,
    date_raw:      r.date   || null,
    accident_date: r.date && r.date !== 'Unknown' ? r.date : null,
    has_coords:    true,
    status:        'active',
    // PostGIS geometry as WKT — Supabase accepts this via st_geomfromtext
    geom:          `SRID=4326;POINT(${r.lng} ${r.lat})`
  }));

console.log(`✅ ${rows.length} records have coordinates — importing to Supabase...`);

// Insert in batches of 100
const BATCH = 100;
let inserted = 0;
let failed = 0;

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await supabase
    .from('accidents')
    .upsert(batch, { onConflict: 'id' });

  if (error) {
    console.error(`❌ Batch ${i / BATCH + 1} failed:`, error.message);
    failed += batch.length;
  } else {
    inserted += batch.length;
    console.log(`   Batch ${i / BATCH + 1}: inserted ${batch.length} rows (total: ${inserted})`);
  }
}

console.log(`\n🎉 Done! Inserted: ${inserted}, Failed: ${failed}`);
