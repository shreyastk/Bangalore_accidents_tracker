import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wb = XLSX.readFile(path.join(__dirname, '..', 'Database', 'Bangalore Accidents Tracker.xlsx'), { cellDates: true, raw: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
const hdr = aoa[0].map(h => String(h || '').toLowerCase());
const linkCol = hdr.indexOf('link');
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

console.log('=== EXCEL FILE CHECK ===');
console.log('Total rows:', rows.length);
console.log('Headers:', aoa[0]);
console.log('');
console.log('=== FIRST 5 ROWS - TITLE + LINK ===');
for (let i = 0; i < 5; i++) {
  const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: linkCol });
  const cell = ws[cellRef];
  const formula = cell?.f || '';
  const val = cell?.v || '';
  const urlMatch = formula.match(/https?:\/\/[^"]+/g);
  const url = urlMatch ? urlMatch.join('') : val;
  console.log(`Row ${i+1}:`);
  console.log(`  Title: ${String(rows[i]?.Title || '').substring(0, 80)}`);
  console.log(`  URL:   ${String(url).substring(0, 100)}`);
  console.log(`  Lat:   ${rows[i]?.Latitude}  Lng: ${rows[i]?.Longitude}`);
  console.log('');
}

// Check if accident_data.json is in sync
import fs from 'fs';
const jsonPath = path.join(__dirname, '..', 'Frontend', 'accident_data.json');
const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
console.log('=== accident_data.json CHECK ===');
console.log('Total records in JSON:', jsonData.length);
console.log('First record title:', jsonData[0]?.title);
console.log('First record link:', String(jsonData[0]?.link || '').substring(0, 80));
console.log('');
console.log('=== SAMPLE LINK TYPES ===');
const rssLinks = jsonData.filter(r => r.link && r.link.includes('news.google.com')).length;
const directLinks = jsonData.filter(r => r.link && !r.link.includes('news.google.com') && r.link !== '#').length;
const noLinks = jsonData.filter(r => !r.link || r.link === '#').length;
console.log('Google News RSS links:', rssLinks);
console.log('Direct article links:', directLinks);
console.log('No links:', noLinks);
