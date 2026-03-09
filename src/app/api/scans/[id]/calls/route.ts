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
          CallID, ScanID, CallType, EntityURL,
          SystemPrompt, UserMessage, RawResponse,
          CallSucceeded, InputCharsEstimate, OutputCharsEstimate,
          InputTokens, OutputTokens, CacheWriteTokens, CacheReadTokens, CostUSD,
          CalledAt, DurationMs, ErrorMessage
        FROM ClCode_ClaudeCallLog
        WHERE ScanID = @id
        ORDER BY CalledAt
      `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('calls error:', err);
    return NextResponse.json({ error: 'Failed to fetch Claude call log' }, { status: 500 });
  }
}
