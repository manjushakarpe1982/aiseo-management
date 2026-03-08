import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * POST /api/urls/setup
 *
 * Creates ClCode_URLs and ClCode_ScanURLs tables if they don't exist,
 * then imports any URLs from the legacy AISEO_PageSEOInputs table that
 * aren't already present in ClCode_URLs.
 *
 * Idempotent – safe to call more than once.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'Admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  try {
    const db = await getDb();

    // ── 1. Create ClCode_URLs ───────────────────────────────────────────────
    await db.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = 'ClCode_URLs'
      )
      BEGIN
        CREATE TABLE ClCode_URLs (
          URLID             INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
          PageURL           NVARCHAR(2048) NOT NULL,
          PageTitle         NVARCHAR(512)  NULL,
          TreeCluster       NVARCHAR(256)  NULL,
          IsActive          BIT            NOT NULL DEFAULT 1,
          Notes             NVARCHAR(1024) NULL,
          ScanRunCount      INT            NOT NULL DEFAULT 0,
          SuggestionsApplied INT           NOT NULL DEFAULT 0,
          LastScanID        INT            NULL,
          LastScannedAt     DATETIME2      NULL,
          CreatedAt         DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
          CreatedByUserID   INT            NULL,
          UpdatedAt         DATETIME2      NULL,
          UpdatedByUserID   INT            NULL,
          CONSTRAINT UQ_ClCode_URLs_PageURL UNIQUE (PageURL)
        );
      END
    `);

    // ── 2. Create ClCode_ScanURLs (junction) ───────────────────────────────
    await db.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = 'ClCode_ScanURLs'
      )
      BEGIN
        CREATE TABLE ClCode_ScanURLs (
          ScanURLID   INT       NOT NULL IDENTITY(1,1) PRIMARY KEY,
          ScanID      INT       NOT NULL,
          URLID       INT       NOT NULL,
          CreatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
        );
      END
    `);

    // ── 3. Import from legacy AISEO_PageSEOInputs ─────────────────────────
    // Only runs if the old table exists
    let importedCount = 0;
    const tableCheck = await db.request().query(`
      SELECT COUNT(1) AS cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'AISEO_PageSEOInputs'
    `);

    if (tableCheck.recordset[0].cnt > 0) {
      const importResult = await db.request()
        .input('userId', sql.Int, session.userId)
        .query(`
          INSERT INTO ClCode_URLs (PageURL, CreatedAt, CreatedByUserID)
          SELECT DISTINCT
            RTRIM(LTRIM(Url)),
            GETUTCDATE(),
            @userId
          FROM AISEO_PageSEOInputs
          WHERE Url IS NOT NULL
            AND LTRIM(RTRIM(Url)) <> ''
            AND NOT EXISTS (
              SELECT 1 FROM ClCode_URLs u
              WHERE u.PageURL = RTRIM(LTRIM(AISEO_PageSEOInputs.Url))
            )
        `);
      importedCount = importResult.rowsAffected[0];
    }

    // ── 4. Return summary ──────────────────────────────────────────────────
    const totalResult = await db.request().query(
      `SELECT COUNT(1) AS total FROM ClCode_URLs`
    );

    return NextResponse.json({
      success: true,
      importedCount,
      totalURLs: totalResult.recordset[0].total,
    });
  } catch (err) {
    console.error('urls/setup error:', err);
    return NextResponse.json({ error: 'Setup failed', detail: String(err) }, { status: 500 });
  }
}
