import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

type Ctx = { params: { id: string } };

/** GET /api/url-groups/[id]  — group detail with members */
export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const groupId = parseInt(params.id);
  if (isNaN(groupId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  try {
    const db = await getDb();
    const result = await db.request()
      .input('groupId', sql.Int, groupId)
      .query(`
        SELECT
          g.GroupID, g.GroupName, g.Description, g.CreatedAt,
          u.URLID, u.PageURL, u.PageTitle, u.PrimaryKeyword, u.Priority
        FROM ClCode_URLGroups g
        LEFT JOIN ClCode_URLGroupMembers m ON m.GroupID = g.GroupID
        LEFT JOIN ClCode_URLs u ON u.URLID = m.URLID
        WHERE g.GroupID = @groupId
      `);

    if (!result.recordset.length) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const first = result.recordset[0];
    const group = {
      GroupID:     first.GroupID,
      GroupName:   first.GroupName,
      Description: first.Description,
      CreatedAt:   first.CreatedAt,
      URLCount:    0,
      members:     [] as any[],
    };

    for (const row of result.recordset) {
      if (row.URLID != null) {
        group.members.push({
          URLID:          row.URLID,
          PageURL:        row.PageURL,
          PageTitle:      row.PageTitle,
          PrimaryKeyword: row.PrimaryKeyword,
          Priority:       row.Priority,
        });
      }
    }
    group.URLCount = group.members.length;

    return NextResponse.json({ group });
  } catch (err: any) {
    console.error('GET /api/url-groups/[id] error:', err);
    return NextResponse.json({ error: 'Failed to fetch group' }, { status: 500 });
  }
}

/** PATCH /api/url-groups/[id]  — update name / description */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const groupId = parseInt(params.id);
  if (isNaN(groupId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const { name, description } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Group name is required' }, { status: 400 });

  try {
    const db = await getDb();
    await db.request()
      .input('groupId',     sql.Int,      groupId)
      .input('name',        sql.NVarChar, name.trim())
      .input('description', sql.NVarChar, description?.trim() || null)
      .query(`
        UPDATE ClCode_URLGroups
        SET GroupName = @name, Description = @description
        WHERE GroupID = @groupId
      `);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PATCH /api/url-groups/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 });
  }
}

/** DELETE /api/url-groups/[id]  — delete group (members auto-cascade) */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const groupId = parseInt(params.id);
  if (isNaN(groupId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  try {
    const db = await getDb();
    await db.request()
      .input('groupId', sql.Int, groupId)
      .query(`DELETE FROM ClCode_URLGroups WHERE GroupID = @groupId`);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('DELETE /api/url-groups/[id] error:', err);
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
  }
}
