import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { BPM_PAGES, findBpmPage } from '@/lib/bpm-pages';
import { getSessionUser } from '@/lib/session';

// ─── GET /api/bpm-seo?id=<pageId>  or  ?url=<url>  or  no params = all pages ──

export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const pageId  = searchParams.get('id');
  const pageUrl = searchParams.get('url');

  try {
    const db = await getDb();

    // Determine which pages to fetch
    const pages = pageId
      ? BPM_PAGES.filter((p) => p.id === pageId)
      : pageUrl
      ? BPM_PAGES.filter((p) => p.url.replace(/\/$/, '') === pageUrl.replace(/\/$/, ''))
      : BPM_PAGES;

    if (pages.length === 0) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const results = await Promise.all(
      pages.map(async (p) => {
        // ── 1. MetaTitle + MetaDescription via SP ─────────────────────────────
        let metaTitle = '';
        let metaDescription = '';
        try {
          const req1 = db.request();
          req1.input('SearchBy',          sql.VarChar(50),  p.searchBy);
          req1.input('MetalText',         sql.VarChar(500), p.metalId);
          req1.input('ProductTypeText',   sql.VarChar(500), p.productTypeId);
          req1.input('MintText',          sql.VarChar(500), p.mintId);
          req1.input('SeriesText',        sql.VarChar(500), p.seriesId);
          req1.input('YearText',          sql.VarChar(500), '');
          req1.input('tagId',             sql.Int,          0);
          req1.input('NarrowByMiscIdCSV', sql.VarChar(500), '');
          req1.output('MetaTitle',        sql.VarChar(500));
          req1.output('MetaDescription',  sql.VarChar(2000));
          const r1 = await req1.execute('Search_GetMetaTitleNDescription');
          metaTitle       = r1.output.MetaTitle       || '';
          metaDescription = r1.output.MetaDescription || '';
        } catch {
          // ignore SP errors for individual pages
        }

        // ── 2. Raw MetaTitle template from FilterPages_SEOData ─────────────────
        let metaTitleTemplate    = '';
        let metaDescTemplate     = '';
        try {
          const r2 = await db.request()
            .input('sb', sql.VarChar(100), p.filterPageSearchBy)
            .query(`SELECT TOP 1 MetaTitle, MetaDescription FROM FilterPages_SEOData WHERE SearchBy = @sb AND IsActive = 1 ORDER BY Id`);
          if (r2.recordset[0]) {
            metaTitleTemplate = r2.recordset[0].MetaTitle        || '';
            metaDescTemplate  = r2.recordset[0].MetaDescription  || '';
          }
        } catch { /* ignore */ }

        // ── 3. H1, Content, CanonicalUrl via SP ───────────────────────────────
        // Use seoMetalId/seoProductTypeId/seoSeriesId (NOT the SP params) because
        // Search_GetSEOContents does exact-match on the stored values.
        let h1           = '';
        let content      = '';
        let canonicalUrl = '';
        try {
          const req3 = db.request();
          req3.input('MetalId',       sql.VarChar(500), p.seoMetalId);
          req3.input('MintId',        sql.VarChar(500), p.seoMintId);
          req3.input('SeriesId',      sql.VarChar(500), p.seoSeriesId);
          req3.input('ProductTypeId', sql.VarChar(500), p.seoProductTypeId);
          req3.input('TagId',         sql.Int,          0);
          req3.output('ContentHeading', sql.VarChar(500));
          req3.output('Content',        sql.VarChar(sql.MAX));
          req3.output('CanonicalUrl',   sql.VarChar(500));
          const r3 = await req3.execute('Search_GetSEOContents');
          h1           = r3.output.ContentHeading || '';
          content      = r3.output.Content        || '';
          canonicalUrl = r3.output.CanonicalUrl   || '';
        } catch { /* ignore */ }

        return {
          id:                    p.id,
          url:                   p.url,
          label:                 p.label,
          searchBy:              p.searchBy,
          metalId:               p.metalId,
          productTypeId:         p.productTypeId,
          seriesId:              p.seriesId,
          seoContentsId:         p.seoContentsId,
          filterPageSearchBy:    p.filterPageSearchBy,
          MetaTitle:             metaTitle,
          MetaTitle_Template:    metaTitleTemplate,
          MetaDescription:       metaDescription,
          MetaDesc_Template:     metaDescTemplate,
          H1:                    h1,
          Content:               content,
          CanonicalUrl:          canonicalUrl,
        };
      })
    );

    return NextResponse.json(pageId || pageUrl ? results[0] : results);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── PUT /api/bpm-seo — update one or more fields for a page ─────────────────
// Body: { id: string, fields: { MetaTitle?, MetaDescription?, H1?, Content?, CanonicalUrl? } }

export async function PUT(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { id: string; fields: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const page = BPM_PAGES.find((p) => p.id === body.id);
  if (!page) {
    // Try URL-based lookup if id not found
    const byUrl = findBpmPage(body.id);
    if (!byUrl) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    body.id = byUrl.id;
    return doPut(byUrl, body.fields);
  }

  return doPut(page, body.fields);
}

async function doPut(page: (typeof BPM_PAGES)[0], fields: Record<string, string>) {
  const db = await getDb();

  const filterFields: Record<string, string>   = {};  // → FilterPages_SEOData
  const contentsFields: Record<string, string> = {};  // → SEOContents

  for (const [key, val] of Object.entries(fields)) {
    if (key === 'MetaTitle' || key === 'MetaDescription') {
      filterFields[key] = val;
    } else if (key === 'H1' || key === 'Content' || key === 'CanonicalUrl') {
      contentsFields[key] = val;
    }
  }

  const updated: string[] = [];

  // ── Update FilterPages_SEOData ────────────────────────────────────────────
  if (Object.keys(filterFields).length > 0) {
    const setClauses: string[] = [];
    const r = db.request().input('sb', sql.VarChar(100), page.filterPageSearchBy);

    if ('MetaTitle' in filterFields) {
      r.input('mt', sql.VarChar(500), filterFields.MetaTitle);
      setClauses.push('MetaTitle = @mt');
    }
    if ('MetaDescription' in filterFields) {
      r.input('md', sql.VarChar(2000), filterFields.MetaDescription);
      setClauses.push('MetaDescription = @md');
    }

    await r.query(
      `UPDATE FilterPages_SEOData SET ${setClauses.join(', ')} WHERE SearchBy = @sb AND IsActive = 1`
    );
    updated.push(...Object.keys(filterFields));
  }

  // ── Update SEOContents ────────────────────────────────────────────────────
  if (Object.keys(contentsFields).length > 0) {
    const setClauses: string[] = [];
    const r = db.request().input('scId', sql.Int, page.seoContentsId);

    if ('H1' in contentsFields) {
      r.input('h1', sql.VarChar(500), contentsFields.H1);
      setClauses.push('ContentHeading = @h1');
    }
    if ('Content' in contentsFields) {
      r.input('content', sql.NVarChar(sql.MAX), contentsFields.Content);
      setClauses.push('Content = @content');
    }
    if ('CanonicalUrl' in contentsFields) {
      r.input('canonical', sql.VarChar(500), contentsFields.CanonicalUrl);
      setClauses.push('CanonicalUrl = @canonical');
    }

    await r.query(`UPDATE SEOContents SET ${setClauses.join(', ')} WHERE Id = @scId`);
    updated.push(...Object.keys(contentsFields).map((k) => (k === 'H1' ? 'H1' : k === 'Content' ? 'PageContent' : k)));
  }

  return NextResponse.json({ success: true, updated });
}
