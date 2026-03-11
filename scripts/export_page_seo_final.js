/**
 * Export BPM gold page SEO data to Excel.
 *
 * All lookup is URL-driven — no hardcoded DB row IDs needed.
 * Add any BPM page URL to the PAGES array below.
 *
 * Usage: node scripts/export_page_seo_final.js
 */

const sql    = require('mssql');
const ExcelJS = require('exceljs');
const path   = require('path');

const config = {
  server: '106.201.231.27', port: 58815, database: 'BPMStagging',
  user: 'sa', password: 'ash@2011',
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 30000,
};

const YEAR = new Date().getFullYear();

// ── Pages to export — add URLs here ──────────────────────────────────────────
const PAGES = [
  { url: 'https://www.boldpreciousmetals.com/gold-bullion' },
  { url: 'https://www.boldpreciousmetals.com/gold-bullion/gold-coins' },
  { url: 'https://www.boldpreciousmetals.com/gold-bullion/gold-coins/american-gold-eagle-coins' },
];

// ── URL → SP / DB params ──────────────────────────────────────────────────────
// Derives all parameters needed from the URL path, no hardcoded IDs.
const METAL_MAP   = { gold: 'Gold', silver: 'Silver', platinum: 'Platinum', palladium: 'Palladium' };
const PT_MAP      = { coins: 'Coins', bars: 'Bars', rounds: 'Rounds', junk: 'Junk Silver' };

function deriveParams(rawUrl) {
  let pathname;
  try { pathname = new URL(rawUrl).pathname.replace(/^\/|\/$/g, ''); }
  catch { throw new Error('Invalid URL: ' + rawUrl); }

  const segs = pathname.toLowerCase().split('/');

  // ── Metal from segment 0 ──
  let metal = null;
  for (const [slug, m] of Object.entries(METAL_MAP)) {
    if (segs[0]?.includes(slug)) { metal = m; break; }
  }
  if (!metal) throw new Error('Cannot determine metal from URL: ' + rawUrl);

  // ── Product type from segment 1 ──
  let productType = '';
  if (segs.length >= 2) {
    for (const [slug, pt] of Object.entries(PT_MAP)) {
      if (segs[1]?.includes(slug)) { productType = pt; break; }
    }
  }

  // ── Series from segment 2 (use the raw slug as stored in DB) ──
  const series = segs.length >= 3 ? segs[2] : '';

  // ── SearchBy ──
  let SearchBy;
  if (segs.length === 1)                           SearchBy = 'metal';
  else if (segs.length === 2 && productType)       SearchBy = 'metalandproducttypes';
  else if (segs.length >= 3 && series)             SearchBy = 'metalNproducttypeNseries';
  else                                             SearchBy = 'metal';

  return { metal, productType, series, SearchBy, filterPageSearchBy: SearchBy };
}

// ── Find the matching SEOContents row by SQL (exact-match, no client filter) ──
// For series pages: match by SeriesId exactly — ProductTypeId may be NULL in DB
// even when the URL has a productType segment (e.g. American Gold Eagle).
async function findSeoContentsRow(pool, { metal, productType, series }) {
  let query, params;

  if (series) {
    // Series page — identify purely by metal + series slug
    query = `
      SELECT TOP 1 Id, ContentHeading AS H1,
             CAST(Content AS NVARCHAR(MAX)) AS Content, CanonicalUrl
      FROM SEOContents
      WHERE IsActive = 1
        AND MetalId         = @metal
        AND SeriesId        = @series
        AND (MintId  IS NULL OR MintId  = '')
        AND (TagId   IS NULL OR TagId   = '')
      ORDER BY Id
    `;
    params = { metal, series };
  } else if (productType) {
    // Product-type page — match metal + productType, no series
    query = `
      SELECT TOP 1 Id, ContentHeading AS H1,
             CAST(Content AS NVARCHAR(MAX)) AS Content, CanonicalUrl
      FROM SEOContents
      WHERE IsActive = 1
        AND MetalId       = @metal
        AND ProductTypeId = @productType
        AND (SeriesId IS NULL OR SeriesId = '')
        AND (MintId   IS NULL OR MintId   = '')
        AND (TagId    IS NULL OR TagId    = '')
      ORDER BY Id
    `;
    params = { metal, productType };
  } else {
    // Metal-only page — metal set, everything else NULL/empty
    query = `
      SELECT TOP 1 Id, ContentHeading AS H1,
             CAST(Content AS NVARCHAR(MAX)) AS Content, CanonicalUrl
      FROM SEOContents
      WHERE IsActive = 1
        AND MetalId         = @metal
        AND (ProductTypeId IS NULL OR ProductTypeId = '')
        AND (SeriesId      IS NULL OR SeriesId      = '')
        AND (MintId        IS NULL OR MintId        = '')
        AND (TagId         IS NULL OR TagId         = '')
      ORDER BY Id
    `;
    params = { metal };
  }

  const r = pool.request();
  if (params.metal)       r.input('metal',       sql.VarChar(500), params.metal);
  if (params.productType) r.input('productType', sql.VarChar(500), params.productType);
  if (params.series)      r.input('series',      sql.VarChar(500), params.series);
  const res = await r.query(query);
  return res.recordset[0] || null;
}

function fillTemplate(tpl, p) {
  if (!tpl) return '';
  return tpl
    .replace(/\{year\}/gi,         YEAR)
    .replace(/\{metal\}/gi,        p.metal)
    .replace(/\{product type\}/gi, p.productType)
    .replace(/\{ProductType\}/gi,  p.productType)
    .replace(/\{Product type\}/gi, p.productType)
    .replace(/\{series\}/gi,       p.series)
    .replace(/\{mint\}/gi,         '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

(async () => {
  const pool = await sql.connect(config);
  console.log('Connected.\n');

  const rows = [];

  for (const page of PAGES) {
    const p = deriveParams(page.url);
    console.log(`── ${page.url}`);
    console.log(`   SearchBy=${p.SearchBy}  metal=${p.metal}  pt=${p.productType || '—'}  series=${p.series || '—'}`);

    // ── 1. MetaTitle + MetaDescription via SP ──────────────────────────────
    let metaTitle = '', metaDescription = '';
    try {
      const r = pool.request();
      r.input('SearchBy',          sql.VarChar(50),   p.SearchBy);
      r.input('MetalText',         sql.VarChar(500),  p.metal);
      r.input('ProductTypeText',   sql.VarChar(500),  p.productType);
      r.input('MintText',          sql.VarChar(500),  '');
      r.input('SeriesText',        sql.VarChar(500),  p.series);
      r.input('YearText',          sql.VarChar(500),  '');
      r.input('tagId',             sql.Int,           0);
      r.input('NarrowByMiscIdCSV', sql.VarChar(500),  '');
      r.output('MetaTitle',        sql.VarChar(500));
      r.output('MetaDescription',  sql.VarChar(2000));
      const res = await r.execute('Search_GetMetaTitleNDescription');
      metaTitle       = res.output.MetaTitle       || '';
      metaDescription = res.output.MetaDescription || '';
    } catch (e) { console.warn('  MetaTitle SP error:', e.message); }

    // ── 2. Raw MetaTitle template from FilterPages_SEOData ─────────────────
    let metaTitleTemplate = '', metaDescTemplate = '';
    try {
      const r2 = await pool.request()
        .input('sb', sql.VarChar(100), p.filterPageSearchBy)
        .query(`SELECT TOP 1 MetaTitle, MetaDescription FROM FilterPages_SEOData WHERE SearchBy=@sb AND IsActive=1 ORDER BY Id`);
      if (r2.recordset[0]) {
        metaTitleTemplate = r2.recordset[0].MetaTitle       || '';
        metaDescTemplate  = r2.recordset[0].MetaDescription || '';
      }
    } catch (e) { console.warn('  FilterPages error:', e.message); }

    // ── 3. H1 + Content + CanonicalUrl — SQL exact-match by derived params ─
    let h1 = '', content = '', canonicalUrl = '', seoContentsId = '';
    try {
      const sc_row = await findSeoContentsRow(pool, p);
      if (sc_row) {
        seoContentsId = sc_row.Id;
        h1            = sc_row.H1           || '';
        content       = sc_row.Content      || '';
        canonicalUrl  = sc_row.CanonicalUrl || '';
      }
    } catch (e) { console.warn('  SEOContents error:', e.message); }

    console.log(`   MetaTitle:    ${metaTitle.slice(0, 80)}`);
    console.log(`   H1:           ${h1 || '(empty in DB)'}`);
    console.log(`   Content len:  ${content.length}${content.length === 0 ? '  ← not yet written' : ''}`);
    console.log(`   CanonicalUrl: ${canonicalUrl || '(empty in DB)'}`);
    console.log(`   SEOContents Id: ${seoContentsId || '(no row found)'}`);
    console.log();

    rows.push({
      URL:                   page.url,
      SP_SearchBy:           p.SearchBy,
      SP_Metal:              p.metal,
      SP_ProductType:        p.productType,
      SP_Series:             p.series,
      SEOContents_Id:        seoContentsId,
      MetaTitle:             metaTitle,
      MetaTitle_Template:    metaTitleTemplate,
      MetaDescription:       metaDescription,
      MetaDesc_Template:     metaDescTemplate,
      H1:                    h1,
      PageContent:           content,
      CanonicalURL:          canonicalUrl,
    });
  }

  await pool.close();

  // ── Build Excel ───────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BPM SEO Page Export';
  wb.created  = new Date();

  const ws = wb.addWorksheet('Page SEO Data', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  });

  ws.columns = [
    { header: 'URL',                         key: 'URL',                width: 65 },
    { header: 'SP SearchBy',                 key: 'SP_SearchBy',        width: 24 },
    { header: 'SP Metal',                    key: 'SP_Metal',           width: 10 },
    { header: 'SP Product Type',             key: 'SP_ProductType',     width: 15 },
    { header: 'SP Series',                   key: 'SP_Series',          width: 36 },
    { header: 'SEOContents DB ID',           key: 'SEOContents_Id',     width: 16 },
    { header: 'Meta Title (resolved)',        key: 'MetaTitle',          width: 72 },
    { header: 'Meta Title (template)',        key: 'MetaTitle_Template', width: 60 },
    { header: 'Meta Description (resolved)', key: 'MetaDescription',    width: 82 },
    { header: 'Meta Desc (template)',         key: 'MetaDesc_Template',  width: 60 },
    { header: 'H1',                          key: 'H1',                 width: 60 },
    { header: 'Page Content (HTML)',         key: 'PageContent',        width: 90 },
    { header: 'Canonical URL',               key: 'CanonicalURL',       width: 65 },
  ];

  // Header style
  ws.getRow(1).height = 24;
  ws.getRow(1).eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  const rowBg  = ['FFFFF7ED', 'FFF0FDF4', 'FFEFF6FF'];
  const missBg = 'FFFEE2E2';

  rows.forEach((row, i) => {
    const r = ws.addRow(row);
    r.height = 100;
    r.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const key     = ws.columns[colNum - 1]?.key;
      const missing = ['MetaTitle', 'MetaDescription', 'H1', 'PageContent'].includes(key)
                      && (!cell.value || String(cell.value).trim() === '');
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: missing ? missBg : rowBg[i % rowBg.length] } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font      = { size: 10 };
    });
  });

  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + ws.columns.length)}1` };

  const outPath = path.join('C:\\Users\\newsa\\Desktop', 'BPM_SEO_Pages.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('Saved:', outPath);
  console.log('Done!');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
