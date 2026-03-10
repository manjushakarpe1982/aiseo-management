import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * POST /api/url-groups/setup
 * Creates ClCode_URLGroups and ClCode_URLGroupMembers tables if they don't exist.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const db = await getDb();

    await db.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ClCode_URLGroups'
      )
      CREATE TABLE ClCode_URLGroups (
        GroupID           INT IDENTITY(1,1) PRIMARY KEY,
        GroupName         NVARCHAR(255) NOT NULL,
        Description       NVARCHAR(500) NULL,
        CreatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        CreatedByUserID   INT           NULL
      );
    `);

    await db.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ClCode_URLGroupMembers'
      )
      CREATE TABLE ClCode_URLGroupMembers (
        GroupID   INT       NOT NULL,
        URLID     INT       NOT NULL,
        AddedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT PK_URLGroupMembers PRIMARY KEY (GroupID, URLID),
        CONSTRAINT FK_URLGroupMembers_Group FOREIGN KEY (GroupID)
          REFERENCES ClCode_URLGroups(GroupID) ON DELETE CASCADE,
        CONSTRAINT FK_URLGroupMembers_URL FOREIGN KEY (URLID)
          REFERENCES ClCode_URLs(URLID) ON DELETE CASCADE
      );
    `);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('url-groups/setup error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
