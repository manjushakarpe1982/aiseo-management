import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * GET /api/urls  — list all URLs with scan stats
 * POST /api/urls — add a new URL
 */

export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const db = await getDb();

    // Check the table exists first
    const tableCheck = await db.request().query(`
      SELECT COUNT(1) AS cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'ClCode_URLs'
    `);
    if (tableCheck.recordset[0].cnt === 0) {
      return NextResponse.json({ urls: [], needsSetup: true });
    }

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

  // Basic URL validation
  let cleanURL = pageURL.trim();
  try {
    new URL(cleanURL);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  // Validate priority
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

    return NextResponse.json({ url: result.recordset[0] }, { status: 201 });
  } catch (err: any) {
    if (err?.message?.includes('UQ_ClCode_URLs_PageURL') || err?.number === 2627 || err?.number === 2601) {
      return NextResponse.json({ error: 'This URL already exists' }, { status: 409 });
    }
    console.error('POST /api/urls error:', err);
    return NextResponse.json({ error: 'Failed to add URL' }, { status: 500 });
  }
}
