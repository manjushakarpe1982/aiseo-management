import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';

export async function GET(req: NextRequest) {
  const scanCode = req.nextUrl.searchParams.get('scanCode');
  if (!scanCode) {
    return NextResponse.json({ error: 'scanCode is required' }, { status: 400 });
  }

  try {
    const db = await getDb();

    const [issueTypes, priorities] = await Promise.all([
      db.request()
        .input('scanCode', sql.VarChar, scanCode)
        .query(`
          SELECT DISTINCT IssueType 
          FROM AISEO_Cannibalization_Errors 
          WHERE ScanCode = @scanCode AND IssueType IS NOT NULL
          ORDER BY IssueType
        `),
      db.request()
        .input('scanCode2', sql.VarChar, scanCode)
        .query(`
          SELECT DISTINCT ErrorPriority 
          FROM AISEO_Cannibalization_Errors 
          WHERE ScanCode = @scanCode2 AND ErrorPriority IS NOT NULL
          ORDER BY ErrorPriority
        `),
    ]);

    return NextResponse.json({
      issueTypes: issueTypes.recordset.map((r: { IssueType: string }) => r.IssueType),
      priorities: priorities.recordset.map((r: { ErrorPriority: number }) => r.ErrorPriority),
    });
  } catch (err) {
    console.error('error-filters error:', err);
    return NextResponse.json({ error: 'Failed to fetch filter options' }, { status: 500 });
  }
}
