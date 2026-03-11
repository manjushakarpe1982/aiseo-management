import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * GET /api/bpm-seo/suggestions
 * Returns all ContentImprovement rows for URLs registered in ClCode_URLs,
 * plus the list of scans that produced them.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const db = await getDb();

    // ── Improvements for all registered URLs (joined to ClCode_URLs) ─────────
    const impResult = await db.request().query(`
      SELECT
        ci.ImprovementID, ci.ScanID, ci.PageURL, ci.FieldName,
        ci.CurrentContent, ci.CurrentCharCount,
        ci.SuggestedContent, ci.SuggestedCharCount,
        ci.IssueType, ci.Reasoning, ci.Priority, ci.ImpactEstimate,
        ci.Status, ci.UserComment, ci.LastAuditedAt,
        u.FullName  AS LastAuditedByName,
        s.ScanName,
        cu.PageTitle AS PageLabel
      FROM ClCode_ContentImprovements ci
      INNER JOIN ClCode_URLs cu ON cu.PageURL = ci.PageURL
      LEFT  JOIN ClCode_Users u ON u.UserID   = ci.LastAuditedByUserID
      LEFT  JOIN ClCode_Scans s ON s.ScanID   = ci.ScanID
      ORDER BY
        ci.ScanID DESC,
        CASE ci.Priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
        ci.PageURL
    `);

    // ── Available scans that have improvements for registered URLs ────────────
    const scansResult = await db.request().query(`
      SELECT DISTINCT s.ScanID, s.ScanName, s.StartedAt
      FROM ClCode_ContentImprovements ci
      INNER JOIN ClCode_URLs cu ON cu.PageURL = ci.PageURL
      JOIN  ClCode_Scans s ON s.ScanID = ci.ScanID
      ORDER BY s.StartedAt DESC
    `);

    return NextResponse.json({
      improvements: impResult.recordset,
      scans:        scansResult.recordset,
    });
  } catch (err) {
    console.error('bpm-seo/suggestions error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
