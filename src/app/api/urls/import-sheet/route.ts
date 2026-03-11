import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { loadFilterPagesMap, lookupSeoData } from '@/lib/seo-lookup';

/**
 * POST /api/urls/import-sheet
 *
 * Fetches a public Google Sheet as CSV, parses it, bulk-inserts rows into
 * ClCode_URLs (skipping duplicates), then for each newly inserted URL calls
 * Search_GetPageSEOData to populate MetaDescription, H1, FirstParagraph,
 * CanonicalUrl and SEOSource directly from the BPM database — no crawling.
 *
 * Body: { sheetUrl: string }
 *
 * Expected sheet columns (order-independent, matched by header name):
 *   New URL | Page Title | Primary Keyword | Secondary Keyword | priority
 */

function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Minimal CSV parser — handles double-quoted fields that contain commas. */
function parseCSV(text: string): string[][] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split('\n')
    .map((line) => {
      const cols: string[] = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
          else { inQuote = !inQuote; }
        } else if (ch === ',' && !inQuote) {
          cols.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cols.push(cur.trim());
      return cols;
    });
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let sheetUrl: string;
  try {
    ({ sheetUrl } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!sheetUrl?.trim()) {
    return NextResponse.json({ error: 'sheetUrl is required' }, { status: 400 });
  }

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) {
    return NextResponse.json({ error: 'Invalid Google Sheets URL — could not extract sheet ID' }, { status: 400 });
  }

  // ── Fetch CSV from Google Sheets ──────────────────────────────────────────
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  let csvText: string;
  try {
    const csvRes = await fetch(csvUrl, { redirect: 'follow' });
    if (!csvRes.ok) throw new Error(`Google returned HTTP ${csvRes.status}`);
    csvText = await csvRes.text();
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to fetch sheet: ${err.message}` },
      { status: 502 },
    );
  }

  // ── Parse CSV ─────────────────────────────────────────────────────────────
  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'Sheet appears empty or has no data rows' }, { status: 400 });
  }

  // Match columns by header name (case-insensitive)
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const col = (keywords: string[]) =>
    header.findIndex((h) => keywords.some((k) => h.includes(k)));

  const urlIdx       = col(['new url', 'url', 'page url']);
  const titleIdx     = col(['page title', 'title']);
  const primaryIdx   = col(['primary keyword']);
  const secondaryIdx = col(['secondary keyword']);
  const priorityIdx  = col(['priority']);

  if (urlIdx === -1) {
    return NextResponse.json(
      { error: 'Could not find a URL column in the sheet (expected "New URL" or "Page URL")' },
      { status: 400 },
    );
  }

  const dataRows = rows.slice(1).filter((r) => r[urlIdx]?.trim());

  // ── Connect to DB and pre-load FilterPages_SEOData ────────────────────────
  const db = await getDb();

  // Pre-load tag map once — shared across all URL lookups in this import
  let fpMap: Awaited<ReturnType<typeof loadFilterPagesMap>>;
  try {
    fpMap = await loadFilterPagesMap(db);
  } catch (err: any) {
    // Non-fatal — fall back to empty map (tag pages will still insert, just without SEO data)
    console.warn('[import-sheet] Could not load FilterPages map:', err.message);
    fpMap = new Map();
  }

  // ── Bulk insert + SEO population ──────────────────────────────────────────
  let inserted    = 0;
  let skipped     = 0;
  let errors      = 0;
  let seoFetched  = 0;
  let seoMissed   = 0;
  const errorDetails: string[] = [];

  for (const row of dataRows) {
    const pageURL        = row[urlIdx]?.trim()         ?? '';
    const pageTitle      = titleIdx     >= 0 ? row[titleIdx]?.trim()     || null : null;
    const primaryKeyword = primaryIdx   >= 0 ? row[primaryIdx]?.trim()   || null : null;
    const secondaryKws   = secondaryIdx >= 0 ? row[secondaryIdx]?.trim() || null : null;
    const priorityRaw    = priorityIdx  >= 0 ? row[priorityIdx]?.trim()  || null : null;
    const priority       = ['High', 'Medium', 'Low'].includes(priorityRaw ?? '') ? priorityRaw : null;

    if (!pageURL) continue;

    // Basic URL validation
    try { new URL(pageURL); } catch {
      errors++;
      errorDetails.push(`Invalid URL: ${pageURL}`);
      continue;
    }

    // ── 1. MERGE into ClCode_URLs (skip if duplicate) ──────────────────────
    let wasInserted = false;
    try {
      const result = await db.request()
        .input('pageURL',           sql.NVarChar, pageURL)
        .input('pageTitle',         sql.NVarChar, pageTitle)
        .input('primaryKeyword',    sql.NVarChar, primaryKeyword)
        .input('secondaryKeywords', sql.NVarChar, secondaryKws)
        .input('priority',          sql.NVarChar, priority)
        .input('userId',            sql.Int,      session.userId)
        .query(`
          MERGE ClCode_URLs AS tgt
          USING (SELECT @pageURL AS PageURL) AS src
            ON tgt.PageURL = src.PageURL
          WHEN NOT MATCHED THEN
            INSERT (PageURL, PageTitle, PrimaryKeyword, SecondaryKeywords, Priority, CreatedAt, CreatedByUserID)
            VALUES (@pageURL, @pageTitle, @primaryKeyword, @secondaryKeywords, @priority, GETUTCDATE(), @userId);
        `);

      wasInserted = (result.rowsAffected?.[0] ?? 0) > 0;
      if (wasInserted) inserted++;
      else skipped++;
    } catch (err: any) {
      errors++;
      errorDetails.push(`DB error for ${pageURL}: ${err.message}`);
      continue;
    }

    // ── 2. For newly inserted rows: fetch all SEO fields from DB ───────────
    if (!wasInserted) continue;

    try {
      const seo = await lookupSeoData(db, pageURL, fpMap);

      await db.request()
        .input('pageURL',       sql.NVarChar(2048),  pageURL)
        // Only overwrite PageTitle if the SP returned a value (DB is source of truth)
        .input('metaTitle',     sql.NVarChar(512),   seo.metaTitle     || null)
        .input('metaDesc',      sql.NVarChar(2000),  seo.metaDescription  || null)
        .input('h1',            sql.NVarChar(512),   seo.h1            || null)
        .input('firstPara',     sql.NVarChar(sql.MAX), seo.firstParagraph || null)
        .input('canonicalUrl',  sql.NVarChar(2048),  seo.canonicalUrl  || null)
        .input('seoSource',     sql.NVarChar(50),    seo.source        || null)
        .query(`
          UPDATE ClCode_URLs
          SET
            PageTitle      = CASE WHEN @metaTitle  IS NOT NULL AND @metaTitle  <> '' THEN @metaTitle  ELSE PageTitle END,
            MetaDescription = @metaDesc,
            H1              = @h1,
            FirstParagraph  = @firstPara,
            CanonicalUrl    = @canonicalUrl,
            SEOSource       = @seoSource,
            SEOFetchedAt    = GETUTCDATE()
          WHERE PageURL = @pageURL
        `);

      if (seo.metaTitle) seoFetched++;
      else seoMissed++;

    } catch (seoErr: any) {
      console.warn(`[import-sheet] SEO lookup failed for ${pageURL}: ${seoErr.message}`);
      seoMissed++;
    }
  }

  return NextResponse.json({
    total:      dataRows.length,
    inserted,
    skipped,
    errors,
    seoFetched,
    seoMissed,
    errorDetails: errorDetails.slice(0, 10), // cap to first 10
  });
}
