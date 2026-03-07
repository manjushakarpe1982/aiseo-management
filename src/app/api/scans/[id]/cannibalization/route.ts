import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const db = await getDb();
    const result = await db.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT
          c.IssueID, c.ScanID, c.PromptID, c.TreeCluster, c.CannibalKeyword,
          c.Severity, c.SeverityReason,
          c.URL1, c.URL1_FieldName, c.URL1_CurrentContent, c.URL1_SuggestedFix,
          c.URL2, c.URL2_FieldName, c.URL2_CurrentContent, c.URL2_SuggestedFix,
          c.OverallRecommendation, c.Reasoning,
          c.Status, c.LastAuditedByUserID, c.LastAuditedAt,
          c.UserComment, c.DeferredReason,
          c.VerifiedFixed, c.VerifiedInScanID, c.CreatedAt,
          u.FullName AS LastAuditedByName
        FROM ClCode_CannibalizationIssues c
        LEFT JOIN ClCode_Users u ON u.UserID = c.LastAuditedByUserID
        WHERE c.ScanID = @id
        ORDER BY
          CASE c.Severity WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
          c.TreeCluster
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('cannibalization error:', err);
    return NextResponse.json({ error: 'Failed to fetch cannibalization issues' }, { status: 500 });
  }
}
