import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const { scanName, mode, urlFilters, limitN, selectedURLIds } = body;

  if (!scanName) {
    return NextResponse.json({ error: 'scanName is required' }, { status: 400 });
  }

  // ── Validate selected URLs (for 'urls' mode) ────────────────────────────
  let selectedURLs: { URLID: number; PageURL: string }[] = [];
  if (mode === 'urls') {
    if (!selectedURLIds || selectedURLIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one URL' }, { status: 400 });
    }
    const db = await getDb();
    // Fetch the actual URLs so we can pass them as filter patterns
    const idList = (selectedURLIds as number[]).join(',');
    const urlResult = await db.request().query(
      `SELECT URLID, PageURL FROM ClCode_URLs WHERE URLID IN (${idList}) AND IsActive = 1`
    );
    selectedURLs = urlResult.recordset;
    if (selectedURLs.length === 0) {
      return NextResponse.json({ error: 'No active URLs found for the selected IDs' }, { status: 400 });
    }
  }

  // ── Build Python CLI args ───────────────────────────────────────────────
  const scriptDir = path.join(process.cwd(), '..');  // /Desktop/Claude/
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
    // Use full URL path as a unique enough pattern (each URL is unique in the table).
    // Pattern format: path-segment:1  (count 1 = match exactly this URL)
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

  args.push('--report');

  // ── Insert scan record ──────────────────────────────────────────────────
  const db = await getDb();
  const scanResult = await db.request()
    .input('name', sql.NVarChar, scanName)
    .input('userId', sql.Int, session.userId)
    .query(`
      INSERT INTO ClCode_Scans (ScanName, Status, StartedByUserID, CreatedAt, StartedAt)
      OUTPUT INSERTED.ScanID
      VALUES (@name, 'Running', @userId, GETUTCDATE(), GETUTCDATE())
    `);
  const scanId: number = scanResult.recordset[0].ScanID;

  // ── Record selected URLs in ClCode_ScanURLs (urls mode) ────────────────
  if (mode === 'urls' && selectedURLs.length > 0) {
    for (const u of selectedURLs) {
      await db.request()
        .input('scanId', sql.Int, scanId)
        .input('urlId', sql.Int, u.URLID)
        .query(`
          INSERT INTO ClCode_ScanURLs (ScanID, URLID, CreatedAt)
          VALUES (@scanId, @urlId, GETUTCDATE())
        `);
    }
    // Bump ScanRunCount on each selected URL
    const idList = selectedURLs.map((u) => u.URLID).join(',');
    await db.request()
      .input('scanId', sql.Int, scanId)
      .query(`
        UPDATE ClCode_URLs
        SET ScanRunCount = ScanRunCount + 1,
            LastScanID   = @scanId,
            LastScannedAt = GETUTCDATE()
        WHERE URLID IN (${idList})
      `);
  }

  // ── Launch Python in background ─────────────────────────────────────────
  const child = spawn('python3', args, {
    detached: true,
    stdio: 'ignore',
    cwd: scriptDir,
  });
  child.unref();

  return NextResponse.json({ scanId }, { status: 201 });
}
