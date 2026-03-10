import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * GET /api/url-groups  — list all groups with URL count
 * POST /api/url-groups — create a new group (optionally with initial member URLs)
 */

export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const db = await getDb();

    // Return empty if table doesn't exist yet
    const check = await db.request().query(`
      SELECT COUNT(1) AS cnt FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'ClCode_URLGroups'
    `);
    if (check.recordset[0].cnt === 0) {
      return NextResponse.json({ groups: [], needsSetup: true });
    }

    const result = await db.request().query(`
      SELECT
        g.GroupID,
        g.GroupName,
        g.Description,
        g.CreatedAt,
        COUNT(m.URLID) AS URLCount
      FROM ClCode_URLGroups g
      LEFT JOIN ClCode_URLGroupMembers m ON m.GroupID = g.GroupID
      GROUP BY g.GroupID, g.GroupName, g.Description, g.CreatedAt
      ORDER BY g.GroupName
    `);

    return NextResponse.json({ groups: result.recordset, needsSetup: false });
  } catch (err: any) {
    console.error('GET /api/url-groups error:', err);
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const { name, description, urlIds } = body as {
    name: string;
    description?: string;
    urlIds?: number[];
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Create group
    const groupResult = await db.request()
      .input('name',        sql.NVarChar, name.trim())
      .input('description', sql.NVarChar, description?.trim() || null)
      .input('userId',      sql.Int,      session.userId)
      .query(`
        INSERT INTO ClCode_URLGroups (GroupName, Description, CreatedAt, CreatedByUserID)
        OUTPUT INSERTED.GroupID, INSERTED.GroupName, INSERTED.Description, INSERTED.CreatedAt
        VALUES (@name, @description, GETUTCDATE(), @userId)
      `);

    const group = groupResult.recordset[0];

    // Add initial members if provided
    if (urlIds?.length) {
      for (const urlId of urlIds) {
        await db.request()
          .input('groupId', sql.Int, group.GroupID)
          .input('urlId',   sql.Int, urlId)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM ClCode_URLGroupMembers WHERE GroupID=@groupId AND URLID=@urlId)
              INSERT INTO ClCode_URLGroupMembers (GroupID, URLID) VALUES (@groupId, @urlId)
          `);
      }
    }

    return NextResponse.json({ group: { ...group, URLCount: urlIds?.length ?? 0 } }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/url-groups error:', err);
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
  }
}
