import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';

export async function GET(req: NextRequest) {
  const scanCode  = req.nextUrl.searchParams.get('scanCode');
  const errorCode = req.nextUrl.searchParams.get('errorCode');
  const url       = req.nextUrl.searchParams.get('url'); // optional

  if (!scanCode || !errorCode) {
    return NextResponse.json({ error: 'scanCode and errorCode are required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await db.request()
      .input('scanCode',  sql.VarChar, scanCode)
      .input('errorCode', sql.VarChar, errorCode)
      .input('url',       sql.VarChar, url ?? null)
      .query(`
        SELECT
          Id, ScanCode, ErrorCode, Url,
          ContentType, OldContent, SuggestedContent
        FROM AISEO_Cannibalization_Fixes
        WHERE ScanCode  = @scanCode
          AND Code = @errorCode
          AND (@url IS NULL OR Url = @url)
        ORDER BY Url, ContentType
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('fixes route error:', err);
    return NextResponse.json({ error: 'Failed to fetch fixes' }, { status: 500 });
  }
}
