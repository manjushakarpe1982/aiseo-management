import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

type Ctx = { params: { id: string } };

/** POST /api/url-groups/[id]/members   — add URL IDs to group */
export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const groupId = parseInt(params.id);
  if (isNaN(groupId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const { urlIds } = await req.json() as { urlIds: number[] };
  if (!Array.isArray(urlIds) || !urlIds.length) {
    return NextResponse.json({ error: 'urlIds array is required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    let added = 0;
    for (const urlId of urlIds) {
      const r = await db.request()
        .input('groupId', sql.Int, groupId)
        .input('urlId',   sql.Int, urlId)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM ClCode_URLGroupMembers WHERE GroupID=@groupId AND URLID=@urlId)
          BEGIN
            INSERT INTO ClCode_URLGroupMembers (GroupID, URLID) VALUES (@groupId, @urlId)
            SELECT 1 AS inserted
          END
          ELSE SELECT 0 AS inserted
        `);
      if (r.recordset[0]?.inserted) added++;
    }
    return NextResponse.json({ added });
  } catch (err: any) {
    console.error('POST members error:', err);
    return NextResponse.json({ error: 'Failed to add members' }, { status: 500 });
  }
}

/** DELETE /api/url-groups/[id]/members  — remove URL IDs from group */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const groupId = parseInt(params.id);
  if (isNaN(groupId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const { urlIds } = await req.json() as { urlIds: number[] };
  if (!Array.isArray(urlIds) || !urlIds.length) {
    return NextResponse.json({ error: 'urlIds array is required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    for (const urlId of urlIds) {
      await db.request()
        .input('groupId', sql.Int, groupId)
        .input('urlId',   sql.Int, urlId)
        .query(`DELETE FROM ClCode_URLGroupMembers WHERE GroupID=@groupId AND URLID=@urlId`);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('DELETE members error:', err);
    return NextResponse.json({ error: 'Failed to remove members' }, { status: 500 });
  }
}
