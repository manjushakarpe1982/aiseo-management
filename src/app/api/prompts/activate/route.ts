import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { promptType, systemPrompt, userPromptTemplate, versionLabel, notes } = body;

  if (!promptType || !systemPrompt || !userPromptTemplate) {
    return NextResponse.json(
      { error: 'promptType, systemPrompt, and userPromptTemplate are required' },
      { status: 400 }
    );
  }

  const validTypes = ['KeywordExtraction', 'Cannibalization', 'ContentImprovement'];
  if (!validTypes.includes(promptType)) {
    return NextResponse.json({ error: 'Invalid promptType' }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Get next version number
    const versionResult = await db.request()
      .input('type', sql.NVarChar, promptType)
      .query(`
        SELECT ISNULL(MAX(VersionNumber), 0) + 1 AS NextVersion
        FROM ClCode_Prompts
        WHERE PromptType = @type
      `);
    const nextVersion: number = versionResult.recordset[0].NextVersion;

    // Deactivate existing active version
    await db.request()
      .input('type', sql.NVarChar, promptType)
      .query(`
        UPDATE ClCode_Prompts
        SET IsActive = 0, DeactivatedAt = GETUTCDATE(), DeactivatedByUserID = 1
        WHERE PromptType = @type AND IsActive = 1
      `);

    // Insert new active version
    const insertResult = await db.request()
      .input('type', sql.NVarChar, promptType)
      .input('version', sql.Int, nextVersion)
      .input('label', sql.NVarChar, versionLabel ?? `v${nextVersion}`)
      .input('system', sql.NVarChar, systemPrompt)
      .input('userTemplate', sql.NVarChar, userPromptTemplate)
      .input('notes', sql.NVarChar, notes ?? null)
      .query(`
        INSERT INTO ClCode_Prompts
          (PromptType, VersionNumber, VersionLabel, SystemPrompt, UserPromptTemplate,
           IsActive, Notes, CreatedAt, CreatedByUserID)
        OUTPUT INSERTED.PromptID
        VALUES (@type, @version, @label, @system, @userTemplate,
                1, @notes, GETUTCDATE(), 1)
      `);

    return NextResponse.json({ promptId: insertResult.recordset[0].PromptID }, { status: 201 });
  } catch (err) {
    console.error('activate prompt error:', err);
    return NextResponse.json({ error: 'Failed to activate prompt' }, { status: 500 });
  }
}
