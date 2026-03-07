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
          ImprovementID, ScanID, PromptID, TreeCluster, PageURL,
          FieldName, CurrentContent, CurrentCharCount,
          SuggestedContent, SuggestedCharCount,
          IssueType, Reasoning, Priority, ImpactEstimate,
          Status, LastAuditedAt, UserComment, DeferredReason,
          VerifiedFixed, VerifiedInScanID, CreatedAt
        FROM ClCode_ContentImprovements
        WHERE ScanID = @id
        ORDER BY
          CASE Priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
          PageURL
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('improvements error:', err);
    return NextResponse.json({ error: 'Failed to fetch improvements' }, { status: 500 });
  }
}
