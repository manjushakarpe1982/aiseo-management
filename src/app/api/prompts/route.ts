import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = await getDb();
    const result = await db.request().query(`
      SELECT
        PromptID, PromptType, VersionNumber, VersionLabel,
        SystemPrompt, UserPromptTemplate,
        IsActive, Notes, CreatedAt, CreatedByUserID,
        DeactivatedAt, DeactivatedByUserID
      FROM ClCode_Prompts
      ORDER BY PromptType, VersionNumber DESC
    `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('prompts error:', err);
    return NextResponse.json({ error: 'Failed to fetch prompts' }, { status: 500 });
  }
}
