import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import type { SerpURL } from '@/lib/types';

/**
 * GET /api/serp
 *
 * Returns active URLs with their full metrics history (within optional date range).
 * Results are grouped by URL and sorted by priority then URL.
 *
 * Query params:
 *   from       YYYY-MM-DD  (optional) start of date range
 *   to         YYYY-MM-DD  (optional) end of date range
 *   priority   High|Medium|Low  (optional)
 *   onlyData   1  (optional) — only return URLs that have ≥1 metric entry
 */
export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from      = searchParams.get('from');
  const to        = searchParams.get('to');
  const priority  = searchParams.get('priority');
  const onlyData  = searchParams.get('onlyData') === '1';

  try {
    const db = await getDb();

    // Check metrics table exists
    const tableCheck = await db.request().query(`
      SELECT COUNT(1) AS cnt FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'ClCode_URLMetrics'
    `);
    if (tableCheck.recordset[0].cnt === 0) {
      return NextResponse.json({ urls: [], needsSetup: true });
    }

    const req2 = db.request();
    req2.input('fromDate', sql.Date, from ? new Date(from) : null);
    req2.input('toDate',   sql.Date, to   ? new Date(to)   : null);

    let priorityClause = '';
    if (priority && ['High', 'Medium', 'Low'].includes(priority)) {
      req2.input('priority', sql.NVarChar, priority);
      priorityClause = 'AND u.Priority = @priority';
    }

    const havingClause = onlyData ? 'HAVING COUNT(m.MetricID) > 0' : '';

    const result = await req2.query(`
      SELECT
        u.URLID,
        u.PageURL,
        u.PrimaryKeyword,
        u.SecondaryKeywords,
        u.Priority,
        u.IsActive,
        m.MetricID,
        CONVERT(VARCHAR(10), m.RecordedDate, 23) AS RecordedDate,
        m.SERPPosition,
        m.SearchVolume,
        m.Notes AS MetricNotes
      FROM ClCode_URLs u
      LEFT JOIN ClCode_URLMetrics m
        ON m.URLID = u.URLID
        AND (@fromDate IS NULL OR m.RecordedDate >= @fromDate)
        AND (@toDate   IS NULL OR m.RecordedDate <= @toDate)
      WHERE u.IsActive = 1
        ${priorityClause}
      ORDER BY
        CASE u.Priority
          WHEN 'High'   THEN 1
          WHEN 'Medium' THEN 2
          WHEN 'Low'    THEN 3
          ELSE 4
        END,
        u.PageURL,
        m.RecordedDate ASC
    `);

    // Group rows by URLID
    const urlMap = new Map<number, SerpURL>();
    for (const row of result.recordset) {
      if (!urlMap.has(row.URLID)) {
        urlMap.set(row.URLID, {
          URLID:             row.URLID,
          PageURL:           row.PageURL,
          PrimaryKeyword:    row.PrimaryKeyword,
          SecondaryKeywords: row.SecondaryKeywords,
          Priority:          row.Priority,
          IsActive:          row.IsActive,
          metrics:           [],
        });
      }
      if (row.MetricID != null) {
        urlMap.get(row.URLID)!.metrics.push({
          MetricID:       row.MetricID,
          URLID:          row.URLID,
          RecordedDate:   row.RecordedDate,
          SERPPosition:   row.SERPPosition,
          SearchVolume:   row.SearchVolume,
          Notes:          row.MetricNotes,
          CreatedAt:      '',
          CreatedByUserID: null,
        });
      }
    }

    let urls = Array.from(urlMap.values());
    if (onlyData) {
      urls = urls.filter((u) => u.metrics.length > 0);
    }

    return NextResponse.json({ urls });
  } catch (err) {
    console.error('GET /api/serp error:', err);
    return NextResponse.json({ error: 'Failed to fetch SERP data' }, { status: 500 });
  }
}
