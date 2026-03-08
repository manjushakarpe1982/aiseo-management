import { NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';

export async function GET() {
  try {
    const db = await getDb();

    const [stats, recent] = await Promise.all([
      db.request().query(`
        SELECT
          (SELECT COUNT(*) FROM ClCode_Scans) AS totalScans,
          (SELECT COUNT(*) FROM ClCode_CannibalizationIssues WHERE Status = 'Yet to Act') +
          (SELECT COUNT(*) FROM ClCode_ContentImprovements WHERE Status = 'Yet to Act') AS openIssues,
          (SELECT COUNT(*) FROM ClCode_CannibalizationIssues WHERE Severity = 'High' AND Status = 'Yet to Act') AS highSeverityCannibalization,
          (SELECT COUNT(*) FROM ClCode_ContentImprovements WHERE Priority = 'High' AND Status = 'Yet to Act') AS highPriorityImprovements
      `),
      db.request().query(`
        SELECT TOP 5
          s.ScanID, s.ScanName, s.Status, s.StartedAt, s.EndedAt,
          s.URLsScraped, s.TreesAnalysed,
          (SELECT COUNT(*) FROM ClCode_CannibalizationIssues WHERE ScanID = s.ScanID) AS CannibalizationCount,
          (SELECT COUNT(*) FROM ClCode_ContentImprovements WHERE ScanID = s.ScanID) AS ImprovementCount
        FROM ClCode_Scans s
        ORDER BY s.ScanID DESC
      `),
    ]);

    const row = stats.recordset[0];
    return NextResponse.json({
      totalScans: row.totalScans,
      openIssues: row.openIssues,
      highSeverityCannibalization: row.highSeverityCannibalization,
      highPriorityImprovements: row.highPriorityImprovements,
      recentScans: recent.recordset,
    });
  } catch (err) {
    console.error('dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
