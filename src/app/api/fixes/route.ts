import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';

export async function PATCH(req: NextRequest) {
  const { id, processedBy } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const db = await getDb();
    await db.request()
      .input('id',          sql.Int,     id)
      .input('processedBy', sql.VarChar, processedBy ?? null)
      .query(`
        UPDATE AISEO_Cannibalization_Fixes
        SET ProcessedBy = @processedBy
        WHERE Id = @id
      `);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('fixes PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update fix' }, { status: 500 });
  }
}

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
          ContentType, OldContent, SuggestedContent, ProcessedBy
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
