import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';

export async function GET(req: NextRequest) {
  const scanCode  = req.nextUrl.searchParams.get('scanCode');
  const issueType = req.nextUrl.searchParams.get('issueType');
  const priority  = req.nextUrl.searchParams.get('priority');
  const url       = req.nextUrl.searchParams.get('url');

  if (!scanCode) {
    return NextResponse.json({ error: 'scanCode is required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await db.request()
      .input('scanCode',  sql.VarChar,  scanCode)
      .input('issueType', sql.VarChar,  issueType ?? null)
      .input('priority',  sql.SmallInt, priority ? parseInt(priority) : null)
      .input('url',       sql.VarChar,  url ?? null)
      .query(`
        SELECT
          Id, Code, Description, IssueType,
          Url1, Url2, Url3, Url4,
          ErrorPriority, Score, ScanCode, CreateTS
        FROM AISEO_Cannibalization_Errors
        WHERE ScanCode = @scanCode
          AND (@issueType IS NULL OR IssueType = @issueType)
          AND (@priority  IS NULL OR ErrorPriority = @priority)
          AND (@url       IS NULL OR Url1 LIKE '%' + @url + '%'
                                  OR Url2 LIKE '%' + @url + '%'
                                  OR Url3 LIKE '%' + @url + '%'
                                  OR Url4 LIKE '%' + @url + '%')
        ORDER BY ErrorPriority DESC, Score DESC
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('errors route error:', err);
    return NextResponse.json({ error: 'Failed to fetch errors' }, { status: 500 });
  }
}
