import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * PATCH /api/urls/[id]
 * Supports: toggle IsActive, update PageTitle / Notes
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
  const { isActive, pageTitle, notes, pageURL } = body;

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
      .input('id', sql.Int, id)
      .input('isActive', sql.Bit, isActive !== undefined ? (isActive ? 1 : 0) : old.IsActive)
      .input('pageTitle', sql.NVarChar, pageTitle !== undefined ? pageTitle : old.PageTitle)
      .input('notes', sql.NVarChar, notes !== undefined ? notes : old.Notes)
      .input('pageURL', sql.NVarChar, pageURL !== undefined ? pageURL.trim() : old.PageURL)
      .input('userId', sql.Int, session.userId)
      .query(`
        UPDATE ClCode_URLs
        SET
          IsActive  = @isActive,
          PageTitle = @pageTitle,
          Notes     = @notes,
          PageURL   = @pageURL,
          UpdatedAt = GETUTCDATE(),
          UpdatedByUserID = @userId
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
