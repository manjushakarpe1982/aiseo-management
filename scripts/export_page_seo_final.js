/**
 * Export BPM gold page SEO data to Excel.
 * Uses exact SEOContents IDs (from bpm-pages.ts) and the SPs used by the API,
 * so the values are guaranteed to match what the web app shows.
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

// ── BPM pages — mirrors src/lib/bpm-pages.ts ─────────────────────────────────
const PAGES = [
  {
    label:              'Gold Bullion',
    url:                'https://www.boldpreciousmetals.com/gold-bullion',
    // Search_GetMetaTitleNDescription params
    SearchBy:           'metal',
    metal:              'Gold',
    productType:        '',
    series:             '',
    mint:               '',
    // Search_GetSEOContents params (use stored values, not SP params)
    seoMetalId:         'Gold',
    seoProductTypeId:   '',        // stored as NULL
    seoSeriesId:        '',        // stored as NULL
    seoMintId:          '',
    // Direct row ID — used to cross-check and select correct row
    seoContentsId:      160,
    filterPageSearchBy: 'metal',
  },
  {
    label:              'Gold Coins',
    url:                'https://www.boldpreciousmetals.com/gold-bullion/gold-coins',
    SearchBy:           'metalandproducttypes',
    metal:              'Gold',
    productType:        'Coins',
    series:             '',
    mint:               '',
    seoMetalId:         'Gold',
    seoProductTypeId:   'Coins',
    seoSeriesId:        '',
    seoMintId:          '',
    seoContentsId:      188,
    filterPageSearchBy: 'metalandproducttypes',
  },
  {
    label:              'American Gold Eagle Coins',
    url:                'https://www.boldpreciousmetals.com/gold-bullion/gold-coins/american-gold-eagle-coins',
    SearchBy:           'metalNproducttypeNseries',
    metal:              'Gold',
    productType:        'Coins',
    series:             'american-gold-eagle-coins',
    mint:               '',
    seoMetalId:         'Gold',
    seoProductTypeId:   '',        // stored as NULL in DB row 393
    seoSeriesId:        'american-gold-eagle-coins',
    seoMintId:          '',
    seoContentsId:      393,
    filterPageSearchBy: 'metalNproducttypeNseries',
  },
];

function fillTemplate(tpl, p) {
  if (!tpl) return '';
  return tpl
    .replace(/\{year\}/gi,         YEAR)
    .replace(/\{metal\}/gi,        p.metal)
    .replace(/\{product type\}/gi, p.productType)
    .replace(/\{ProductType\}/gi,  p.productType)
    .replace(/\{Product type\}/gi, p.productType)
    .replace(/\{series\}/gi,       p.series)
    .replace(/\{mint\}/gi,         p.mint)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

(async () => {
  const pool = await sql.connect(config);
  console.log('Connected.\n');

  const rows = [];

  for (const p of PAGES) {
    console.log(`── ${p.label}`);

    // ── 1. MetaTitle + MetaDescription via SP ──────────────────────────────
    let metaTitle = '', metaDescription = '';
    try {
      const r = pool.request();
      r.input('SearchBy',          sql.VarChar(50),   p.SearchBy);
      r.input('MetalText',         sql.VarChar(500),  p.metal);
      r.input('ProductTypeText',   sql.VarChar(500),  p.productType);
      r.input('MintText',          sql.VarChar(500),  p.mint);
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
    } catch (e) { console.warn('  FilterPages SP error:', e.message); }

    // ── 3. H1 + Content + CanonicalUrl — query directly by known ID ────────
    //    (The SP Search_GetSEOContents uses the same seo* params but the
    //     direct-ID query is unambiguous and avoids row-matching bugs.)
    let h1 = '', content = '', canonicalUrl = '';
    try {
      const r3 = await pool.request()
        .input('id', sql.Int, p.seoContentsId)
        .query(`
          SELECT ContentHeading AS H1,
                 CAST(Content AS NVARCHAR(MAX)) AS Content,
                 CanonicalUrl
          FROM SEOContents
          WHERE Id = @id
        `);
      if (r3.recordset[0]) {
        h1           = r3.recordset[0].H1           || '';
        content      = r3.recordset[0].Content       || '';
        canonicalUrl = r3.recordset[0].CanonicalUrl  || '';
      }
    } catch (e) { console.warn('  SEOContents query error:', e.message); }

    console.log(`  MetaTitle:   ${metaTitle.slice(0, 80)}`);
    console.log(`  MetaDesc:    ${metaDescription.slice(0, 80)}`);
    console.log(`  H1:          ${h1 || '(empty in DB)'}`);
    console.log(`  Content len: ${content.length}${content.length === 0 ? '  ← not yet written' : ''}`);
    console.log(`  CanonicalUrl:${canonicalUrl || '(empty in DB)'}`);
    console.log();

    rows.push({
      URL:                   p.url,
      Label:                 p.label,
      SP_SearchBy:           p.SearchBy,
      SP_Metal:              p.metal,
      SP_ProductType:        p.productType,
      SP_Series:             p.series,
      SEOContents_Id:        p.seoContentsId,
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
    { header: 'Category / Label',            key: 'Label',              width: 28 },
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
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: missing ? missBg : rowBg[i] } };
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
