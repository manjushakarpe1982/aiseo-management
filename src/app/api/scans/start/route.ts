import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const { scanName, mode, urlFilters, limitN, selectedURLIds, analyses, provider } = body;

    // analyses is an array of enabled phases e.g. ['keyword','cannibalization','content']
    const runKeyword         = !analyses || (analyses as string[]).includes('keyword');
    const runCannibalization = !analyses || (analyses as string[]).includes('cannibalization');
    const runContent         = !analyses || (analyses as string[]).includes('content');

    if (!scanName) {
      return NextResponse.json({ error: 'scanName is required' }, { status: 400 });
    }

    const db = await getDb();

    // ── Validate selected URLs (for 'urls' mode) ──────────────────────────
    let selectedURLs: { URLID: number; PageURL: string }[] = [];
    if (mode === 'urls') {
      if (!selectedURLIds || selectedURLIds.length === 0) {
        return NextResponse.json({ error: 'Select at least one URL' }, { status: 400 });
      }
      const idList = (selectedURLIds as number[]).join(',');
      const urlResult = await db.request().query(
        `SELECT URLID, PageURL FROM ClCode_URLs WHERE URLID IN (${idList}) AND IsActive = 1`
      );
      selectedURLs = urlResult.recordset;
      if (selectedURLs.length === 0) {
        return NextResponse.json({ error: 'No active URLs found for the selected IDs' }, { status: 400 });
      }
    }

    // ── Fetch active prompt IDs (required NOT NULL columns in ClCode_Scans) ─
    const promptResult = await db.request().query(
      `SELECT PromptType, PromptID FROM ClCode_Prompts WHERE IsActive = 1`
    );
    const prompts: Record<string, number> = {};
    for (const row of promptResult.recordset) {
      prompts[row.PromptType] = row.PromptID;
    }
    const cannibalizationPromptId = prompts['Cannibalization'] ?? 0;
    const contentPromptId         = prompts['ContentImprovement'] ?? 0;
    const runId = `NEXTJS_${Date.now()}`;

    // ── Build Python CLI args ─────────────────────────────────────────────
    const scriptDir = process.cwd();  // project root: aiseo-management/
    const args: string[] = [
      path.join(scriptDir, 'run_scan.py'),
      'scan',
      '--name', scanName,
      '--user', String(session.userId),
    ];

    if (mode === 'filters' && urlFilters && urlFilters.length > 0) {
      const pairs = (urlFilters as { pattern: string; count: number }[])
        .filter((f) => f.pattern && f.count)
        .map((f) => `${f.pattern}:${f.count}`);
      if (pairs.length > 0) {
        args.push('--url-filters', ...pairs);
      }
    } else if (mode === 'limit' && limitN) {
      args.push('--limit', String(limitN));
    } else if (mode === 'urls' && selectedURLs.length > 0) {
      const pairs = selectedURLs.map((u) => {
        try {
          const p = new URL(u.PageURL).pathname.replace(/^\//, '').replace(/\/$/, '');
          return `${p}:1`;
        } catch {
          return null;
        }
      }).filter(Boolean) as string[];
      if (pairs.length > 0) {
        args.push('--url-filters', ...pairs);
      }
    }

    // Skip flags
    if (!runKeyword)         args.push('--skip-keyword');
    if (!runCannibalization) args.push('--skip-cannibalization');
    if (!runContent)         args.push('--skip-content');

    // AI provider
    if (provider === 'gemini') args.push('--provider', 'gemini');

    args.push('--report');

    // ── Insert scan record with all required NOT NULL columns ─────────────
    // Python will find this record by ScanName (Status='Running') and resume it.
    const scanResult = await db.request()
      .input('runId',   sql.NVarChar, runId)
      .input('name',    sql.NVarChar, scanName)
      .input('userId',  sql.Int,      session.userId)
      .input('cannibId',sql.Int,      cannibalizationPromptId)
      .input('contId',  sql.Int,      contentPromptId)
      .query(`
        INSERT INTO ClCode_Scans
          (RunID, ScanName, StartedAt, StartedByUserID,
           TotalURLs, URLsScraped, TreesAnalysed, Status,
           CannibalizationPromptID, ContentPromptID,
           CreatedAt, CreatedByUserID)
        OUTPUT INSERTED.ScanID
        VALUES
          (@runId, @name, GETUTCDATE(), @userId,
           0, 0, 0, 'Running',
           @cannibId, @contId,
           GETUTCDATE(), @userId)
      `);
    const scanId: number = scanResult.recordset[0].ScanID;

    // ── Launch Python in background ───────────────────────────────────────
    const child = spawn('python', args, {
      detached: true,
      stdio:    'ignore',
      cwd:      scriptDir,
    });
    child.unref();

    return NextResponse.json({ scanId }, { status: 201 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/scans/start]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
