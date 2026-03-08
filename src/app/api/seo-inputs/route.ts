import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';

export async function PATCH(req: NextRequest) {
  const { id, status, processedBy, comments } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const db = await getDb();
    await db.request()
      .input('id',          sql.Int,     id)
      .input('status',      sql.VarChar, status ?? 'Yet to check')
      .input('processedBy', sql.VarChar, processedBy ?? null)
      .input('comments',    sql.NVarChar, comments ?? null)
      .query(`
        UPDATE AISEO_PageSEOInputs
        SET Status = @status, ProcessedBy = @processedBy, Comments = @comments
        WHERE Id = @id
      `);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('seo-inputs PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update SEO input' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const scanCode = req.nextUrl.searchParams.get('scanCode');
  if (!scanCode) {
    return NextResponse.json({ error: 'scanCode is required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await db.request()
      .input('scanCode', sql.VarChar, scanCode)
      .query(`
        SELECT
          Id, Url, PageName,
          MetaTitle,            SuggestedMetaTitle,
          MetaDescription,      SuggestedMetaDescription,
          H1,                   SuggestedH1,
          H2,                   SuggestedH2,
          H3,                   SuggestedH3,
          H4,                   SuggestedH4,
          H5,                   SuggestedH5,
          H6,                   SuggestedH6,
          Content,              SuggestedContent,
          PrimaryKeywords, SecondaryKeyword,
          WordCount, InternalLinks, ExternalLinks,
          StatusCode, SEO_Priority AS Priority, IsAddressed,
          ScrapedDateTime, Status, ProcessedBy, Comments
        FROM AISEO_PageSEOInputs
        WHERE scancode = @scanCode
        ORDER BY SEO_Priority DESC, Url
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('seo-inputs error:', err);
    return NextResponse.json({ error: 'Failed to fetch SEO inputs' }, { status: 500 });
  }
}
