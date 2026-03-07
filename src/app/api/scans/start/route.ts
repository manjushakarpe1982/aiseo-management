import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { getDb, sql } from '@/lib/db';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { scanName, mode, urlFilters, limitN } = body;

  if (!scanName) {
    return NextResponse.json({ error: 'scanName is required' }, { status: 400 });
  }

  // Build the CLI args
  const scriptDir = path.join(process.cwd(), '..'); // /Desktop/Claude/
  const args: string[] = [
    path.join(scriptDir, 'run_scan.py'),
    'scan',
    '--name', scanName,
    '--user', '1',
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
  }

  args.push('--report');

  // Insert scan record immediately so we have an ID to redirect to
  const db = await getDb();
  const scanResult = await db.request()
    .input('name', sql.NVarChar, scanName)
    .query(`
      INSERT INTO ClCode_Scans (ScanName, Status, StartedByUserID, CreatedAt, StartedAt)
      OUTPUT INSERTED.ScanID
      VALUES (@name, 'Running', 1, GETUTCDATE(), GETUTCDATE())
    `);
  const scanId: number = scanResult.recordset[0].ScanID;

  // Launch Python in background
  const child = spawn('python3', args, {
    detached: true,
    stdio: 'ignore',
    cwd: scriptDir,
  });
  child.unref();

  return NextResponse.json({ scanId }, { status: 201 });
}
