/**
 * seo-lookup.ts
 *
 * Derives all SEO fields for a BPM page URL from the database — no
 * page crawling needed for most pages.  Handles three page types:
 *
 *   Tag page     → FilterPages_SEOData by slug + SEOContents by TagId
 *   Metal / ProductType / Series page → Search_GetPageSEOData SP
 *
 * Special case — 8 static landing pages:
 *   /gold-bullion, /gold-bullion/gold-coins, /gold-bullion/gold-bars,
 *   /gold-bullion/gold-rounds, /silver-bullion, /silver-bullion/silver-coins,
 *   /silver-bullion/silver-bars, /silver-bullion/silver-rounds
 *   These have hardcoded frontend content (not stored in SEOContents).
 *   When the SP returns empty H1+Content for a 1- or 2-segment URL,
 *   we automatically fall back to crawling the live page.
 *
 * Typical usage (bulk import):
 *
 *   const fpMap = await loadFilterPagesMap(pool);
 *   for (const url of urls) {
 *     const seo = await lookupSeoData(pool, url, fpMap);
 *     // seo.metaTitle, seo.h1, seo.firstParagraph …
 *   }
 */

import { getDb, sql } from '@/lib/db';

type Pool = Awaited<ReturnType<typeof getDb>>;

// ── Constants ─────────────────────────────────────────────────────────────────

const METAL_SLUGS: [string, string][] = [
  ['silver',    'Silver'],
  ['gold',      'Gold'],
  ['platinum',  'Platinum'],
  ['palladium', 'Palladium'],
];

const PT_SLUGS: [string, string][] = [
  ['coins',  'Coins'],
  ['bars',   'Bars'],
  ['rounds', 'Rounds'],
  ['junk',   'Junk Silver'],
];

// ── Template substitution ─────────────────────────────────────────────────────

export function fillTemplate(
  tpl: string,
  { metal = '', productType = '' }: { metal?: string; productType?: string } = {},
): string {
  if (!tpl) return '';
  const year = new Date().getFullYear();
  return tpl
    .replace(/\{year\}/gi,         String(year))
    .replace(/\{metal\}/gi,        metal)
    .replace(/\{product type\}/gi, productType)
    .replace(/\{ProductType\}/gi,  productType)
    .replace(/\{Product type\}/gi, productType)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── HTML content helpers ──────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities to get plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g,  ' ')
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&#39;/g,   "'")
    .replace(/\s{2,}/g,  ' ')
    .trim();
}

/**
 * Extracts the plain-text content of the first <p> tag (min 40 chars)
 * from an HTML string — skips short/nav snippets.
 */
export function extractFirstParagraph(html: string): string {
  if (!html) return '';

  // Try paragraphs in order, pick first one with meaningful content (≥40 chars)
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const text = stripHtml(match[1]);
    if (text.length >= 40) return text;
  }
  return '';
}

/** Extract the text of the first <h1> tag. */
function extractH1(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? stripHtml(match[1]) : '';
}

// ── Live-page crawler (fallback for 8 static landing pages) ──────────────────

/**
 * Fetches a live URL and extracts H1 + first paragraph.
 * Only called when SEOContents has no content for 1- or 2-segment URLs.
 */
async function crawlPageContent(
  pageUrl: string,
): Promise<{ h1: string; firstParagraph: string }> {
  try {
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BPM-SEO-Bot/1.0)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[seo-lookup] Crawl ${pageUrl} returned HTTP ${res.status}`);
      return { h1: '', firstParagraph: '' };
    }
    const html = await res.text();
    return {
      h1:             extractH1(html),
      firstParagraph: extractFirstParagraph(html),
    };
  } catch (e: any) {
    console.warn(`[seo-lookup] Crawl failed (${pageUrl}): ${e.message}`);
    return { h1: '', firstParagraph: '' };
  }
}

// ── URL parser ────────────────────────────────────────────────────────────────

export interface ParsedUrl {
  parts:       string[];
  metal:       string;
  productType: string;
  lastSeg:     string;
  searchBy:    string;   // 'metal' | 'metalandproducttypes' | 'metalNproducttypeNseries'
  seriesText:  string;   // non-empty only for 3-segment non-tag pages
}

export function parseUrlSegments(rawUrl: string): ParsedUrl | null {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname.toLowerCase().replace(/^\/|\/$/g, '');
  } catch {
    return null;
  }

  const parts = pathname.split('/');

  let metal = '';
  for (const [slug, m] of METAL_SLUGS) {
    if (parts[0]?.includes(slug)) { metal = m; break; }
  }
  if (!metal) return null;

  let productType = '';
  if (parts.length >= 2) {
    for (const [slug, pt] of PT_SLUGS) {
      if (parts[1]?.includes(slug)) { productType = pt; break; }
    }
  }

  const lastSeg = parts[parts.length - 1] ?? '';

  let searchBy: string;
  if (parts.length === 1)      searchBy = 'metal';
  else if (parts.length === 2) searchBy = 'metalandproducttypes';
  else                         searchBy = 'metalNproducttypeNseries';

  return {
    parts,
    metal,
    productType,
    lastSeg,
    searchBy,
    seriesText: parts.length >= 3 ? lastSeg : '',
  };
}

// ── FilterPages pre-loader ────────────────────────────────────────────────────

export type FpMap = Map<string, { MetaTitle: string; MetaDescription: string }>;

/**
 * Pre-loads all active FilterPages_SEOData rows into a Map keyed by
 * lowercase SearchBy.  Call once before processing a batch of URLs.
 */
export async function loadFilterPagesMap(pool: Pool): Promise<FpMap> {
  const res = await pool.request().query(
    `SELECT SearchBy, MetaTitle, MetaDescription
     FROM FilterPages_SEOData
     WHERE IsActive = 1`,
  );
  const map: FpMap = new Map();
  for (const r of res.recordset) {
    if (r.SearchBy) map.set(r.SearchBy.toLowerCase().trim(), r);
  }
  return map;
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface SeoLookupResult {
  metaTitle:         string;
  metaDescription:   string;
  metaTitleTemplate: string;
  metaDescTemplate:  string;
  h1:                string;
  firstParagraph:    string;  // plain text — first meaningful <p>
  canonicalUrl:      string;
  seoContentsId:     number | null;
  /** Where the content came from:
   *  'SP'        — all fields from Search_GetPageSEOData SP (DB content)
   *  'SP+crawl'  — MetaTitle/Desc from SP, H1+content crawled (8 static pages)
   *  'tag'       — FilterPages_SEOData + SEOContents by TagId
   *  'error'     — SP call failed
   *  'unknown'   — URL could not be parsed
   */
  source: 'SP' | 'SP+crawl' | 'tag' | 'unknown' | 'error';
}

const EMPTY_RESULT: SeoLookupResult = {
  metaTitle: '', metaDescription: '', metaTitleTemplate: '', metaDescTemplate: '',
  h1: '', firstParagraph: '', canonicalUrl: '', seoContentsId: null, source: 'unknown',
};

// ── Main lookup function ──────────────────────────────────────────────────────

/**
 * Returns all SEO fields for a given BPM page URL.
 *
 * @param pool    Active mssql connection pool
 * @param pageUrl Full page URL
 * @param fpMap   Pre-loaded FilterPages_SEOData map (from loadFilterPagesMap)
 */
export async function lookupSeoData(
  pool:    Pool,
  pageUrl: string,
  fpMap:   FpMap,
): Promise<SeoLookupResult> {

  const segs = parseUrlSegments(pageUrl);
  if (!segs) return { ...EMPTY_RESULT };

  const isTag = segs.parts.length >= 3 && fpMap.has(segs.lastSeg);

  // ── Tag page ──────────────────────────────────────────────────────────────
  if (isTag) {
    const fp               = fpMap.get(segs.lastSeg)!;
    const metaTitleTemplate = fp.MetaTitle       ?? '';
    const metaDescTemplate  = fp.MetaDescription ?? '';

    const metaTitle       = fillTemplate(metaTitleTemplate, { metal: segs.metal, productType: segs.productType });
    const metaDescription = fillTemplate(metaDescTemplate,  { metal: segs.metal, productType: segs.productType });

    let h1 = '', firstParagraph = '', canonicalUrl = '', seoContentsId: number | null = null;
    try {
      const r = await pool.request()
        .input('tagId', sql.VarChar(500), segs.lastSeg)
        .query(`
          SELECT TOP 1
            Id,
            ISNULL(CAST(ContentHeading AS NVARCHAR(MAX)), '') AS H1,
            ISNULL(CAST(Content        AS NVARCHAR(MAX)), '') AS Content,
            ISNULL(CanonicalUrl, '')                          AS CanonicalUrl
          FROM SEOContents
          WHERE IsActive = 1
            AND TagId = @tagId
          ORDER BY Id
        `);

      if (r.recordset[0]) {
        const row     = r.recordset[0];
        seoContentsId = row.Id;
        h1            = row.H1           ?? '';
        canonicalUrl  = row.CanonicalUrl ?? '';
        firstParagraph = extractFirstParagraph(row.Content ?? '');
      }
    } catch (e: any) {
      console.warn(`[seo-lookup] SEOContents tag lookup failed (${segs.lastSeg}): ${e.message}`);
    }

    return {
      metaTitle, metaDescription,
      metaTitleTemplate, metaDescTemplate,
      h1, firstParagraph, canonicalUrl, seoContentsId,
      source: 'tag',
    };
  }

  // ── Metal / ProductType / Series page — Search_GetPageSEOData SP ──────────
  try {
    const r = pool.request();
    r.input('SearchBy',          sql.VarChar(50),   segs.searchBy);
    r.input('MetalText',         sql.VarChar(500),  segs.metal);
    r.input('ProductTypeText',   sql.VarChar(500),  segs.productType);
    r.input('MintText',          sql.VarChar(500),  '');
    r.input('SeriesText',        sql.VarChar(500),  segs.seriesText);
    r.input('YearText',          sql.VarChar(500),  '');
    r.input('tagId',             sql.Int,           0);
    r.input('NarrowByMiscIdCSV', sql.VarChar(500),  '');

    const res = await r.execute('Search_GetPageSEOData');
    // Use the LAST recordset — the inner Search_GetMetaTitleNDescription SP may
    // produce intermediate recordsets; our final SELECT is always the last one.
    const recordsets = res.recordsets as any[][];
    const row = (recordsets[recordsets.length - 1] ?? res.recordset)?.[0];
    if (!row) return { ...EMPTY_RESULT, source: 'SP' };

    const dbContent   = row.PageContent ?? '';
    let h1            = row.H1 ?? '';
    let firstParagraph = extractFirstParagraph(dbContent);
    let source: SeoLookupResult['source'] = 'SP';

    // ── Fallback: crawl live page for the 8 static landing pages ─────────
    // Condition: 1- or 2-segment URL where DB returned no H1 or content.
    // These pages have hardcoded frontend content not stored in SEOContents.
    if (segs.parts.length <= 2 && !h1 && !firstParagraph) {
      console.log(`[seo-lookup] Static page — crawling ${pageUrl}`);
      const crawled = await crawlPageContent(pageUrl);
      h1             = crawled.h1;
      firstParagraph = crawled.firstParagraph;
      source         = 'SP+crawl';
    }

    return {
      metaTitle:         row.MetaTitle         ?? '',
      metaDescription:   row.MetaDescription   ?? '',
      metaTitleTemplate: row.MetaTitle_Template ?? '',
      metaDescTemplate:  row.MetaDesc_Template  ?? '',
      h1,
      firstParagraph,
      canonicalUrl:      row.CanonicalUrl       ?? '',
      seoContentsId:     row.SEOContents_Id     ?? null,
      source,
    };
  } catch (e: any) {
    console.warn(`[seo-lookup] Search_GetPageSEOData failed (${pageUrl}): ${e.message}`);
    return { ...EMPTY_RESULT, source: 'error' };
  }
}
