import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await req.json();
  const { status, comment, deferredReason } = body;

  const validStatuses = ['Yet to Act', 'Acted', 'Deferred'];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  try {
    const db = await getDb();

    const current = await db.request()
      .input('id', sql.Int, id)
      .query(`SELECT Status, UserComment, URL1 FROM ClCode_CannibalizationIssues WHERE IssueID = @id`);

    if (current.recordset.length === 0) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    const old = current.recordset[0];

    await db.request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar, status ?? old.Status)
      .input('comment', sql.NVarChar, comment ?? null)
      .input('deferredReason', sql.NVarChar, deferredReason ?? null)
      .input('userId', sql.Int, session.userId)
      .query(`
        UPDATE ClCode_CannibalizationIssues
        SET
          Status = @status,
          UserComment = @comment,
          DeferredReason = @deferredReason,
          LastAuditedAt = GETUTCDATE(),
          LastAuditedByUserID = @userId
        WHERE IssueID = @id
      `);

    await db.request()
      .input('entityType', sql.NVarChar, 'CannibalizationIssue')
      .input('entityID', sql.Int, id)
      .input('entityURL', sql.NVarChar, old.URL1 ?? null)
      .input('actionType', sql.NVarChar, 'StatusUpdate')
      .input('oldValue', sql.NVarChar, old.Status)
      .input('newValue', sql.NVarChar, status ?? old.Status)
      .input('comment', sql.NVarChar, comment ?? null)
      .input('userId', sql.Int, session.userId)
      .query(`
        INSERT INTO ClCode_AuditLog
          (AuditedByUserID, AuditedAt, EntityType, EntityID, EntityURL,
           ActionType, OldValue, NewValue, Comment)
        VALUES
          (@userId, GETUTCDATE(), @entityType, @entityID, @entityURL,
           @actionType, @oldValue, @newValue, @comment)
      `);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('cannibalization PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update issue' }, { status: 500 });
  }
}
