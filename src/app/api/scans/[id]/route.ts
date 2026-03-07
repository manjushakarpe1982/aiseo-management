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
          s.ScanID, s.RunID, s.ScanName, s.Status,
          s.StartedAt, s.EndedAt,
          s.TotalURLs, s.URLsScraped, s.TreesAnalysed,
          s.CannibalizationPromptID, s.ContentPromptID,
          s.ErrorLog, s.Notes, s.CreatedAt,
          cp.VersionLabel AS CannibalizationPromptLabel,
          cp.VersionNumber AS CannibalizationPromptVersion,
          cip.VersionLabel AS ContentPromptLabel,
          cip.VersionNumber AS ContentPromptVersion,
          (SELECT COUNT(*) FROM ClCode_CannibalizationIssues WHERE ScanID = s.ScanID) AS CannibalizationCount,
          (SELECT COUNT(*) FROM ClCode_ContentImprovements WHERE ScanID = s.ScanID) AS ImprovementCount,
          (SELECT COUNT(*) FROM ClCode_PageKeywords WHERE ScanID = s.ScanID) AS KeywordCount,
          (SELECT COUNT(*) FROM ClCode_ClaudeCallLog WHERE ScanID = s.ScanID) AS CallCount
        FROM ClCode_Scans s
        LEFT JOIN ClCode_Prompts cp ON cp.PromptID = s.CannibalizationPromptID
        LEFT JOIN ClCode_Prompts cip ON cip.PromptID = s.ContentPromptID
        WHERE s.ScanID = @id
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }
    return NextResponse.json(result.recordset[0]);
  } catch (err) {
    console.error('scan detail error:', err);
    return NextResponse.json({ error: 'Failed to fetch scan' }, { status: 500 });
  }
}
