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
          IssueID, ScanID, PromptID, TreeCluster, CannibalKeyword,
          Severity, SeverityReason,
          URL1, URL1_FieldName, URL1_CurrentContent, URL1_SuggestedFix,
          URL2, URL2_FieldName, URL2_CurrentContent, URL2_SuggestedFix,
          OverallRecommendation, Reasoning,
          Status, LastAuditedAt, UserComment, DeferredReason,
          VerifiedFixed, VerifiedInScanID, CreatedAt
        FROM ClCode_CannibalizationIssues
        WHERE ScanID = @id
        ORDER BY
          CASE Severity WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
          TreeCluster
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('cannibalization error:', err);
    return NextResponse.json({ error: 'Failed to fetch cannibalization issues' }, { status: 500 });
  }
}
