import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = await getDb();
    const result = await db.request().query(`
      SELECT
        s.ScanID, s.RunID, s.ScanName, s.Status,
        s.StartedAt, s.EndedAt,
        s.TotalURLs, s.URLsScraped, s.TreesAnalysed,
        s.CannibalizationPromptID, s.ContentPromptID,
        s.Notes, s.ErrorLog,
        (SELECT COUNT(*) FROM ClCode_CannibalizationIssues WHERE ScanID = s.ScanID) AS CannibalizationCount,
        (SELECT COUNT(*) FROM ClCode_ContentImprovements WHERE ScanID = s.ScanID) AS ImprovementCount
      FROM ClCode_Scans s
      ORDER BY s.ScanID DESC
    `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('scans list error:', err);
    return NextResponse.json({ error: 'Failed to fetch scans' }, { status: 500 });
  }
}
