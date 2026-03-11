/**
 * Generate an Excel import file from the Google Sheet of silver BPM URLs.
 * For each URL, calls Search_GetMetaTitleNDescription SP to get PageTitle.
 *
 * Output format (matches /api/urls/import-sheet):
 *   New URL | Page Title | Primary Keyword | Secondary Keyword | priority
 *
 * Usage: node scripts/generate_url_import.js
 */

const sql    = require('mssql');
const ExcelJS = require('exceljs');
const https  = require('https');
const path   = require('path');

const SHEET_ID = '1jE8o1ItY8-ZtExzemEhFtXRI81Z6lBLbFe24FWnfnZg';

const DB_CONFIG = {
  server: '106.201.231.27', port: 58815, database: 'BPMStagging',
  user: 'sa', password: 'ash@2011',
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 30000,
};

// ── Minimal CSV parser (handles quoted fields) ────────────────────────────────
function parseCSV(text) {
  return text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    .split('\n')
    .map((line) => {
      const cols = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
          else { inQuote = !inQuote; }
        } else if (ch === ',' && !inQuote) {
          cols.push(cur.trim()); cur = '';
        } else { cur += ch; }
      }
      cols.push(cur.trim());
      return cols;
    });
}

// ── HTTP GET with redirect follow ─────────────────────────────────────────────
function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ── URL → SP params ───────────────────────────────────────────────────────────
// Maps the BPM URL path pattern to Search_GetMetaTitleNDescription parameters.
const METAL_SLUGS = [
  ['silver',    'Silver'],
  ['gold',      'Gold'],
  ['platinum',  'Platinum'],
  ['palladium', 'Palladium'],
];
const PT_SLUGS = [
  ['coins',   'Coins'],
  ['bars',    'Bars'],
  ['rounds',  'Rounds'],
  ['junk',    'Junk Silver'],
];

function urlToSpParams(rawUrl) {
  let pathname;
  try { pathname = new URL(rawUrl).pathname.toLowerCase().replace(/^\/|\/$/g, ''); }
  catch { return null; }

  const parts = pathname.split('/');

  let metal = null;
  for (const [slug, m] of METAL_SLUGS) {
    if (parts[0]?.includes(slug)) { metal = m; break; }
  }
  if (!metal) return null;

  if (parts.length === 1) {
    return { SearchBy: 'metal', MetalText: metal, ProductTypeText: '', MintText: '', SeriesText: '' };
  }

  let productType = '';
  for (const [slug, pt] of PT_SLUGS) {
    if (parts[1]?.includes(slug)) { productType = pt; break; }
  }

  if (parts.length === 2) {
    return { SearchBy: 'metalandproducttypes', MetalText: metal, ProductTypeText: productType, MintText: '', SeriesText: '' };
  }

  // 3+ segments — series level (pass URL slug; SP uses it as-is or resolves it)
  return { SearchBy: 'metalNproducttypeNseries', MetalText: metal, ProductTypeText: productType, MintText: '', SeriesText: parts[2] };
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  // 1. Fetch sheet CSV
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
  console.log('Fetching Google Sheet CSV…');
  const csvText = await fetchText(csvUrl);
  const rows    = parseCSV(csvText);

  if (rows.length < 2) { console.error('Sheet appears empty'); process.exit(1); }

  const header  = rows[0].map((h) => h.toLowerCase().trim());
  const urlIdx  = header.findIndex((h) => h.includes('url'));
  const keyIdx  = header.findIndex((h) => h.includes('primary') && h.includes('keyword'));
  const prioIdx = header.findIndex((h) => h.includes('priority'));

  if (urlIdx === -1) { console.error('No URL column found in sheet'); process.exit(1); }

  const dataRows = rows.slice(1).filter((r) => r[urlIdx]?.trim());
  console.log(`Found ${dataRows.length} URL rows (header: ${rows[0].join(' | ')})\n`);

  // 2. Connect to DB
  const pool = await sql.connect(DB_CONFIG);
  console.log('Connected to DB\n');

  const results = [];
  let spHit = 0, spMiss = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row            = dataRows[i];
    const pageUrl        = row[urlIdx]?.trim()  ?? '';
    const primaryKw      = keyIdx  >= 0 ? row[keyIdx]?.trim()  ?? '' : '';
    const priority       = prioIdx >= 0 ? row[prioIdx]?.trim() ?? '' : '';

    const params = urlToSpParams(pageUrl);
    let pageTitle = '';

    if (params) {
      try {
        const r = pool.request();
        r.input('SearchBy',          sql.VarChar(50),   params.SearchBy);
        r.input('MetalText',         sql.VarChar(500),  params.MetalText);
        r.input('ProductTypeText',   sql.VarChar(500),  params.ProductTypeText);
        r.input('MintText',          sql.VarChar(500),  params.MintText);
        r.input('SeriesText',        sql.VarChar(500),  params.SeriesText);
        r.input('YearText',          sql.VarChar(500),  '');
        r.input('tagId',             sql.Int,           0);
        r.input('NarrowByMiscIdCSV', sql.VarChar(500),  '');
        r.output('MetaTitle',        sql.VarChar(500));
        r.output('MetaDescription',  sql.VarChar(2000));
        const res = await r.execute('Search_GetMetaTitleNDescription');
        pageTitle = res.output.MetaTitle || '';
        if (pageTitle) spHit++; else spMiss++;
      } catch (e) {
        console.warn(`  SP error for [${pageUrl}]: ${e.message}`);
        spMiss++;
      }
    } else {
      spMiss++;
    }

    results.push({
      'New URL':          pageUrl,
      'Page Title':       pageTitle,
      'Primary Keyword':  primaryKw,
      'Secondary Keyword': '',
      'priority':         priority,
    });

    if ((i + 1) % 25 === 0 || (i + 1) === dataRows.length) {
      console.log(`  Processed ${i + 1}/${dataRows.length}  (hits: ${spHit}, misses: ${spMiss})`);
    }
  }

  await pool.close();
  console.log(`\nSP hits: ${spHit}  |  misses: ${spMiss}\n`);

  // 3. Build Excel
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BPM URL Import Generator';
  wb.created = new Date();

  const ws = wb.addWorksheet('BPM Silver URLs', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'New URL',           key: 'New URL',           width: 72 },
    { header: 'Page Title',        key: 'Page Title',        width: 62 },
    { header: 'Primary Keyword',   key: 'Primary Keyword',   width: 36 },
    { header: 'Secondary Keyword', key: 'Secondary Keyword', width: 36 },
    { header: 'priority',          key: 'priority',          width: 12 },
  ];

  // Header style
  ws.getRow(1).height = 22;
  ws.getRow(1).eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  for (const r of results) {
    const missingTitle = !r['Page Title'];
    const wsRow = ws.addRow(r);
    wsRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const key = ws.columns[colNum - 1]?.key;
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: (key === 'Page Title' && missingTitle) ? 'FFFEE2E2' : 'FFFFFFFF' },
      };
      cell.font = { size: 10 };
    });
  }

  ws.autoFilter = { from: 'A1', to: 'E1' };

  // Stats summary on a second sheet
  const ws2 = wb.addWorksheet('Stats');
  ws2.addRow(['Generated',      new Date().toISOString()]);
  ws2.addRow(['Total URLs',     results.length]);
  ws2.addRow(['Title found',    spHit]);
  ws2.addRow(['Title missing',  spMiss]);
  ws2.addRow(['Sheet source',   `https://docs.google.com/spreadsheets/d/${SHEET_ID}`]);

  const outPath = path.join('C:\\Users\\newsa\\Desktop', 'BPM_URLs_Silver_Import.xlsx');
  await wb.xlsx.writeFile(outPath);

  console.log(`Saved: ${outPath}`);
  console.log(`Total rows: ${results.length}`);
  console.log('Done!');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
