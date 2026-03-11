import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { loadFilterPagesMap, lookupSeoData } from '@/lib/seo-lookup';

/**
 * GET /api/urls  — list all URLs with scan stats + latest SERP/volume
 * POST /api/urls — add a new URL
 */

export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const db = await getDb();

    // Check the URLs table exists first
    const tableCheck = await db.request().query(`
      SELECT COUNT(1) AS cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'ClCode_URLs'
    `);
    if (tableCheck.recordset[0].cnt === 0) {
      return NextResponse.json({ urls: [], needsSetup: true });
    }

    // Check if metrics table exists — add subqueries only if it does
    const metricsCheck = await db.request().query(`
      SELECT COUNT(1) AS cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'ClCode_URLMetrics'
    `);
    const hasMetrics = metricsCheck.recordset[0].cnt > 0;

    const metricsColumns = hasMetrics
      ? `,
        (SELECT TOP 1 m.SERPPosition
           FROM ClCode_URLMetrics m WHERE m.URLID = u.URLID
           ORDER BY m.RecordedDate DESC) AS LatestSERPPosition,
        (SELECT TOP 1 m.SearchVolume
           FROM ClCode_URLMetrics m WHERE m.URLID = u.URLID
           ORDER BY m.RecordedDate DESC) AS LatestSearchVolume,
        CONVERT(VARCHAR(10),
          (SELECT TOP 1 m.RecordedDate
             FROM ClCode_URLMetrics m WHERE m.URLID = u.URLID
             ORDER BY m.RecordedDate DESC), 23) AS LatestMetricDate`
      : `, NULL AS LatestSERPPosition, NULL AS LatestSearchVolume, NULL AS LatestMetricDate`;

    const result = await db.request().query(`
      SELECT
        u.URLID,
        u.PageURL,
        u.PageTitle,
        u.TreeCluster,
        u.IsActive,
        u.Notes,
        u.PrimaryKeyword,
        u.SecondaryKeywords,
        u.Priority,
        u.ScanRunCount,
        u.SuggestionsApplied,
        u.LastScanID,
        u.LastScannedAt,
        u.CreatedAt,
        u.UpdatedAt
        ${metricsColumns}
      FROM ClCode_URLs u
      ORDER BY u.PageURL
    `);

    return NextResponse.json({ urls: result.recordset, needsSetup: false });
  } catch (err) {
    console.error('GET /api/urls error:', err);
    return NextResponse.json({ error: 'Failed to fetch URLs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const { pageURL, pageTitle, notes, primaryKeyword, secondaryKeywords, priority } = body;

  if (!pageURL || !pageURL.trim()) {
    return NextResponse.json({ error: 'pageURL is required' }, { status: 400 });
  }

  let cleanURL = pageURL.trim();
  try { new URL(cleanURL); }
  catch { return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 }); }

  if (priority && !['High', 'Medium', 'Low'].includes(priority)) {
    return NextResponse.json({ error: 'Priority must be High, Medium, or Low' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await db.request()
      .input('pageURL',           sql.NVarChar, cleanURL)
      .input('pageTitle',         sql.NVarChar, pageTitle?.trim()         || null)
      .input('notes',             sql.NVarChar, notes?.trim()             || null)
      .input('primaryKeyword',    sql.NVarChar, primaryKeyword?.trim()    || null)
      .input('secondaryKeywords', sql.NVarChar, secondaryKeywords?.trim() || null)
      .input('priority',          sql.NVarChar, priority                  || null)
      .input('userId',            sql.Int,      session.userId)
      .query(`
        INSERT INTO ClCode_URLs
          (PageURL, PageTitle, Notes, PrimaryKeyword, SecondaryKeywords, Priority, CreatedAt, CreatedByUserID)
        OUTPUT INSERTED.*
        VALUES
          (@pageURL, @pageTitle, @notes, @primaryKeyword, @secondaryKeywords, @priority, GETUTCDATE(), @userId)
      `);

    const inserted = result.recordset[0];

    // ── SEO lookup — populate MetaDescription, H1, FirstParagraph etc. from DB ──
    try {
      const fpMap = await loadFilterPagesMap(db);
      const seo   = await lookupSeoData(db, cleanURL, fpMap);

      await db.request()
        .input('pageURL',      sql.NVarChar(2048),    cleanURL)
        .input('metaTitle',    sql.NVarChar(512),     seo.metaTitle        || null)
        .input('metaDesc',     sql.NVarChar(2000),    seo.metaDescription  || null)
        .input('h1',           sql.NVarChar(512),     seo.h1               || null)
        .input('firstPara',    sql.NVarChar(sql.MAX), seo.firstParagraph   || null)
        .input('canonicalUrl', sql.NVarChar(2048),    seo.canonicalUrl     || null)
        .input('seoSource',    sql.NVarChar(50),      seo.source           || null)
        .query(`
          UPDATE ClCode_URLs SET
            PageTitle       = CASE WHEN @metaTitle IS NOT NULL AND @metaTitle <> '' THEN @metaTitle ELSE PageTitle END,
            MetaDescription = @metaDesc,
            H1              = @h1,
            FirstParagraph  = @firstPara,
            CanonicalUrl    = @canonicalUrl,
            SEOSource       = @seoSource,
            SEOFetchedAt    = GETUTCDATE()
          WHERE PageURL = @pageURL
        `);

      // Return the row with SEO fields merged in
      inserted.MetaDescription = seo.metaDescription || null;
      inserted.H1              = seo.h1              || null;
      inserted.FirstParagraph  = seo.firstParagraph  || null;
      inserted.CanonicalUrl    = seo.canonicalUrl    || null;
      inserted.SEOSource       = seo.source          || null;
      if (seo.metaTitle) inserted.PageTitle = seo.metaTitle;
    } catch (seoErr: any) {
      // Non-fatal — URL is already saved, SEO fields just stay null for now
      console.warn(`[POST /api/urls] SEO lookup failed for ${cleanURL}: ${seoErr.message}`);
    }

    return NextResponse.json({ url: inserted }, { status: 201 });
  } catch (err: any) {
    if (err?.message?.includes('UQ_ClCode_URLs_PageURL') || err?.number === 2627 || err?.number === 2601) {
      return NextResponse.json({ error: 'This URL already exists' }, { status: 409 });
    }
    console.error('POST /api/urls error:', err);
    return NextResponse.json({ error: 'Failed to add URL' }, { status: 500 });
  }
}
