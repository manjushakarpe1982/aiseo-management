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
          ci.ImprovementID, ci.ScanID, ci.PromptID, ci.TreeCluster, ci.PageURL,
          ci.FieldName, ci.CurrentContent, ci.CurrentCharCount,
          ci.SuggestedContent, ci.SuggestedCharCount,
          ci.IssueType, ci.Reasoning, ci.Priority, ci.ImpactEstimate,
          ci.Status, ci.LastAuditedByUserID, ci.LastAuditedAt,
          ci.UserComment, ci.DeferredReason,
          ci.VerifiedFixed, ci.VerifiedInScanID, ci.CreatedAt,
          u.FullName AS LastAuditedByName
        FROM ClCode_ContentImprovements ci
        LEFT JOIN ClCode_Users u ON u.UserID = ci.LastAuditedByUserID
        WHERE ci.ScanID = @id
        ORDER BY
          CASE ci.Priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
          ci.PageURL
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('improvements error:', err);
    return NextResponse.json({ error: 'Failed to fetch improvements' }, { status: 500 });
  }
}
