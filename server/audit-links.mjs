import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wb = XLSX.readFile(path.join(__dirname, '..', 'Database', 'Bangalore Accidents Tracker.xlsx'), { cellDates: true, raw: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
const hdr = aoa[0].map(h => String(h || '').toLowerCase());
const linkCol = hdr.indexOf('link');

let googleRss = 0, directLink = 0, noLink = 0;
const mismatches = [];

rows.forEach((r, i) => {
  const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: linkCol });
  const cell = ws[cellRef];
  const formula = cell?.f || '';
  const urls = formula.match(/https?:\/\/[^"&\s]+/g) || [];
  const url = urls.join('') || String(cell?.v || '');

  const title = String(r.Title || '').trim();
  const titleSource = title.split(' - ').pop().trim(); // e.g. "NDTV", "The Hindu"

  let domain = '';
  try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = ''; }

  if (!url || url === 'Open Link' || !domain) {
    noLink++;
  } else if (url.includes('news.google.com/rss')) {
    googleRss++;
  } else {
    directLink++;
    // Check if title source and link domain roughly match
    const srcLower = titleSource.toLowerCase();
    const domLower = domain.toLowerCase();
    const knownMap = {
      'ndtv': 'ndtv', 'the hindu': 'thehindu', 'deccan chronicle': 'deccanchronicle',
      'bangalore mirror': 'bangaloremirror', 'times of india': 'timesofindia',
      'the news minute': 'thenewsminute', 'india today': 'indiatoday',
      'new indian express': 'newindianexpress', 'hindustan times': 'hindustantimes',
      'scroll': 'scroll', 'the wire': 'thewire', 'firstpost': 'firstpost',
    };
    let mismatch = false;
    for (const [src, dom] of Object.entries(knownMap)) {
      if (srcLower.includes(src) && !domLower.includes(dom)) {
        mismatch = true;
        break;
      }
    }
    if (mismatch) {
      mismatches.push({ row: i + 1, title: title.substring(0, 70), titleSource, domain, url: url.substring(0, 80) });
    }
  }
});

console.log('=== LINK TYPE BREAKDOWN ===');
console.log('Direct article links:', directLink);
console.log('Google News RSS links (may redirect correctly):', googleRss);
console.log('No link / unresolved:', noLink);
console.log('Total rows:', rows.length);
console.log('');
console.log('=== DETECTED TITLE/SOURCE vs LINK DOMAIN MISMATCHES ===');
if (mismatches.length === 0) {
  console.log('No clear mismatches found in direct links.');
} else {
  mismatches.forEach(m => {
    console.log(`Row ${m.row}: Title says "${m.titleSource}" but link goes to "${m.domain}"`);
    console.log(`  Title: ${m.title}`);
    console.log(`  URL:   ${m.url}`);
  });
}
console.log('');
console.log('NOTE: Google News RSS links cannot be verified without following the redirect.');
console.log('These', googleRss, 'links go through Google and may or may not match the title.');
