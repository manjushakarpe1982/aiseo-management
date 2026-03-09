import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * GET  /api/urls/[id]/metrics  — list all daily metrics for a URL (newest first)
 * POST /api/urls/[id]/metrics  — upsert a metric entry for a specific date
 */

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const db = await getDb();

    // Check table exists (may not be set up yet)
    const tableCheck = await db.request().query(`
      SELECT COUNT(1) AS cnt FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'ClCode_URLMetrics'
    `);
    if (tableCheck.recordset[0].cnt === 0) {
      return NextResponse.json({ metrics: [], needsSetup: true });
    }

    const result = await db.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT
          MetricID,
          URLID,
          CONVERT(VARCHAR(10), RecordedDate, 23) AS RecordedDate,
          SERPPosition,
          SearchVolume,
          Notes,
          CreatedAt,
          CreatedByUserID
        FROM ClCode_URLMetrics
        WHERE URLID = @id
        ORDER BY RecordedDate DESC
      `);

    return NextResponse.json({ metrics: result.recordset });
  } catch (err) {
    console.error('GET /api/urls/[id]/metrics error:', err);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await req.json();
  const { recordedDate, serpPosition, searchVolume, notes } = body;

  if (!recordedDate) {
    return NextResponse.json({ error: 'recordedDate is required' }, { status: 400 });
  }

  // Parse values
  const serpVal  = serpPosition  != null && serpPosition  !== '' ? parseInt(String(serpPosition))  : null;
  const volVal   = searchVolume  != null && searchVolume  !== '' ? parseInt(String(searchVolume))  : null;

  if (serpVal  !== null && (isNaN(serpVal)  || serpVal  < 1))  return NextResponse.json({ error: 'SERP position must be a positive integer'  }, { status: 400 });
  if (volVal   !== null && (isNaN(volVal)   || volVal   < 0))  return NextResponse.json({ error: 'Search volume must be a non-negative integer' }, { status: 400 });

  try {
    const db = await getDb();

    // Upsert: update on matching URL+date, insert otherwise
    const result = await db.request()
      .input('urlId',        sql.Int,      id)
      .input('recordedDate', sql.Date,     new Date(recordedDate))
      .input('serpPosition', sql.Int,      serpVal)
      .input('searchVolume', sql.Int,      volVal)
      .input('notes',        sql.NVarChar, notes?.trim() || null)
      .input('userId',       sql.Int,      session.userId)
      .query(`
        MERGE ClCode_URLMetrics AS target
        USING (VALUES (@urlId, @recordedDate)) AS src(URLID, RecordedDate)
          ON target.URLID = src.URLID AND target.RecordedDate = src.RecordedDate
        WHEN MATCHED THEN
          UPDATE SET
            SERPPosition    = @serpPosition,
            SearchVolume    = @searchVolume,
            Notes           = @notes,
            CreatedAt       = GETUTCDATE(),
            CreatedByUserID = @userId
        WHEN NOT MATCHED THEN
          INSERT (URLID, RecordedDate, SERPPosition, SearchVolume, Notes, CreatedAt, CreatedByUserID)
          VALUES (@urlId, @recordedDate, @serpPosition, @searchVolume, @notes, GETUTCDATE(), @userId)
        OUTPUT
          INSERTED.MetricID,
          INSERTED.URLID,
          CONVERT(VARCHAR(10), INSERTED.RecordedDate, 23) AS RecordedDate,
          INSERTED.SERPPosition,
          INSERTED.SearchVolume,
          INSERTED.Notes,
          INSERTED.CreatedAt,
          INSERTED.CreatedByUserID;
      `);

    return NextResponse.json({ metric: result.recordset[0] }, { status: 201 });
  } catch (err) {
    console.error('POST /api/urls/[id]/metrics error:', err);
    return NextResponse.json({ error: 'Failed to save metric' }, { status: 500 });
  }
}
