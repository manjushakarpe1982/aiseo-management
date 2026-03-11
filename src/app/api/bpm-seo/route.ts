import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * GET /api/bpm-seo          — list all URLs from ClCode_URLs with their SEO fields
 * GET /api/bpm-seo?urlId=N  — single URL by URLID
 * GET /api/bpm-seo?url=...  — single URL by PageURL
 *
 * PUT /api/bpm-seo          — update SEO fields in ClCode_URLs
 *   Body: { urlId: number, fields: { MetaTitle?, MetaDescription?, H1?, Content?, CanonicalUrl? } }
 *   Content maps to FirstParagraph column.
 */

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const urlId  = searchParams.get('urlId');
  const urlVal = searchParams.get('url');

  try {
    const db = await getDb();

    let whereClause = '';
    const request = db.request();

    if (urlId) {
      whereClause = 'WHERE URLID = @urlId';
      request.input('urlId', sql.Int, parseInt(urlId, 10));
    } else if (urlVal) {
      whereClause = 'WHERE PageURL = @pageURL';
      request.input('pageURL', sql.NVarChar(2048), urlVal);
    }

    const result = await request.query(`
      SELECT
        URLID,
        PageURL,
        ISNULL(PageTitle, '') AS PageTitle,
        ISNULL(MetaDescription, '') AS MetaDescription,
        ISNULL(H1, '') AS H1,
        ISNULL(FirstParagraph, '') AS FirstParagraph,
        ISNULL(CanonicalUrl, '') AS CanonicalUrl,
        SEOSource,
        SEOFetchedAt,
        IsActive
      FROM ClCode_URLs
      ${whereClause}
      ORDER BY PageURL
    `);

    const rows = result.recordset.map((r) => {
      // Derive a human-readable label from PageTitle or the last URL path segment
      const urlPath = (() => {
        try { return new URL(r.PageURL).pathname; } catch { return r.PageURL; }
      })();
      const lastSegment = urlPath.replace(/\/$/, '').split('/').pop() ?? urlPath;
      const label = r.PageTitle
        || lastSegment.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

      return {
        URLID:          r.URLID,
        url:            r.PageURL,
        label,
        MetaTitle:      r.PageTitle,
        MetaDescription: r.MetaDescription,
        H1:             r.H1,
        Content:        r.FirstParagraph,   // UI uses "Content" key
        CanonicalUrl:   r.CanonicalUrl,
        SEOSource:      r.SEOSource,
        SEOFetchedAt:   r.SEOFetchedAt,
        IsActive:       r.IsActive,
      };
    });

    if (urlId || urlVal) {
      if (rows.length === 0) return NextResponse.json({ error: 'URL not found' }, { status: 404 });
      return NextResponse.json(rows[0]);
    }

    return NextResponse.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { urlId: number; fields: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.urlId || typeof body.urlId !== 'number') {
    return NextResponse.json({ error: 'urlId (number) is required' }, { status: 400 });
  }
  if (!body.fields || typeof body.fields !== 'object' || Object.keys(body.fields).length === 0) {
    return NextResponse.json({ error: 'fields object is required and must not be empty' }, { status: 400 });
  }

  // Map UI field keys → ClCode_URLs column names
  const COLUMN_MAP: Record<string, string> = {
    MetaTitle:       'PageTitle',
    MetaDescription: 'MetaDescription',
    H1:              'H1',
    Content:         'FirstParagraph',   // "Content" in UI = FirstParagraph in DB
    CanonicalUrl:    'CanonicalUrl',
  };

  const setClauses: string[] = [];
  const updated: string[] = [];

  try {
    const db = await getDb();
    const request = db.request().input('urlId', sql.Int, body.urlId);

    let paramIdx = 0;
    for (const [key, value] of Object.entries(body.fields)) {
      const col = COLUMN_MAP[key];
      if (!col) continue;  // ignore unknown keys

      const paramName = `p${paramIdx++}`;
      request.input(paramName, sql.NVarChar(sql.MAX), value ?? null);
      setClauses.push(`${col} = @${paramName}`);
      updated.push(key);
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No recognised fields to update' }, { status: 400 });
    }

    // Always touch UpdatedAt
    setClauses.push('UpdatedAt = GETUTCDATE()');
    request.input('userId', sql.Int, session.userId);
    setClauses.push('UpdatedByUserID = @userId');

    await request.query(
      `UPDATE ClCode_URLs SET ${setClauses.join(', ')} WHERE URLID = @urlId`
    );

    return NextResponse.json({ success: true, updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
