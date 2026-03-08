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
          KeywordID, ScanID, PromptID, PageURL, TreeCluster,
          PrimaryKeyword, SecondaryKeywords, SearchIntent,
          KeywordGaps, MissingLSITerms, ContentFocusScore, CreatedAt
        FROM ClCode_PageKeywords
        WHERE ScanID = @id
        ORDER BY TreeCluster, PageURL
      `);

    const rows = result.recordset.map((r) => ({
      ...r,
      SecondaryKeywords: parseJsonArr(r.SecondaryKeywords),
      KeywordGaps: parseJsonArr(r.KeywordGaps),
      MissingLSITerms: parseJsonArr(r.MissingLSITerms),
    }));

    return NextResponse.json(rows);
  } catch (err) {
    console.error('keywords error:', err);
    return NextResponse.json({ error: 'Failed to fetch keywords' }, { status: 500 });
  }
}

function parseJsonArr(val: string | null): string[] {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}
