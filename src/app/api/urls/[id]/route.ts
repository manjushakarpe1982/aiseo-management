import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * PATCH /api/urls/[id]
 * Supports: toggle IsActive, update PageURL / PageTitle / Notes /
 *           PrimaryKeyword / SecondaryKeywords / Priority
 *
 * DELETE /api/urls/[id]
 * Deletes the URL and its associated metrics.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await req.json();
  const { isActive, pageTitle, notes, pageURL, primaryKeyword, secondaryKeywords, priority } = body;

  // Validate priority if supplied
  if (priority !== undefined && priority !== null && !['High', 'Medium', 'Low'].includes(priority)) {
    return NextResponse.json({ error: 'Priority must be High, Medium, or Low' }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Fetch current row
    const current = await db.request()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM ClCode_URLs WHERE URLID = @id`);

    if (current.recordset.length === 0) {
      return NextResponse.json({ error: 'URL not found' }, { status: 404 });
    }

    const old = current.recordset[0];

    await db.request()
      .input('id',               sql.Int,      id)
      .input('isActive',         sql.Bit,      isActive !== undefined         ? (isActive ? 1 : 0)                      : old.IsActive)
      .input('pageTitle',        sql.NVarChar, pageTitle !== undefined        ? pageTitle                               : old.PageTitle)
      .input('notes',            sql.NVarChar, notes !== undefined            ? notes                                   : old.Notes)
      .input('pageURL',          sql.NVarChar, pageURL !== undefined          ? pageURL.trim()                          : old.PageURL)
      .input('primaryKeyword',   sql.NVarChar, primaryKeyword !== undefined   ? (primaryKeyword?.trim() || null)        : old.PrimaryKeyword)
      .input('secondaryKeywords',sql.NVarChar, secondaryKeywords !== undefined? (secondaryKeywords?.trim() || null)     : old.SecondaryKeywords)
      .input('priority',         sql.NVarChar, priority !== undefined         ? (priority || null)                      : old.Priority)
      .input('userId',           sql.Int,      session.userId)
      .query(`
        UPDATE ClCode_URLs
        SET
          IsActive          = @isActive,
          PageTitle         = @pageTitle,
          Notes             = @notes,
          PageURL           = @pageURL,
          PrimaryKeyword    = @primaryKeyword,
          SecondaryKeywords = @secondaryKeywords,
          Priority          = @priority,
          UpdatedAt         = GETUTCDATE(),
          UpdatedByUserID   = @userId
        WHERE URLID = @id
      `);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.message?.includes('UQ_ClCode_URLs_PageURL') || err?.number === 2627 || err?.number === 2601) {
      return NextResponse.json({ error: 'That URL already exists' }, { status: 409 });
    }
    console.error('PATCH /api/urls/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update URL' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const db = await getDb();

    // Check the URL exists
    const current = await db.request()
      .input('id', sql.Int, id)
      .query(`SELECT URLID FROM ClCode_URLs WHERE URLID = @id`);

    if (current.recordset.length === 0) {
      return NextResponse.json({ error: 'URL not found' }, { status: 404 });
    }

    // Delete metrics first (if table exists)
    const metricsExists = await db.request().query(`
      SELECT COUNT(1) AS cnt FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'ClCode_URLMetrics'
    `);
    if (metricsExists.recordset[0].cnt > 0) {
      await db.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM ClCode_URLMetrics WHERE URLID = @id`);
    }

    // Delete the URL
    await db.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM ClCode_URLs WHERE URLID = @id`);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /api/urls/[id] error:', err);
    return NextResponse.json({ error: 'Failed to delete URL' }, { status: 500 });
  }
}
