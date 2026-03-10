import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * POST /api/urls/import-sheet
 *
 * Fetches a public Google Sheet as CSV, parses it, and bulk-inserts
 * rows into ClCode_URLs (skipping duplicates).
 *
 * Body: { sheetUrl: string }
 *
 * Expected sheet columns (order-independent, matched by header name):
 *   New URL | Page Title | Primary Keyword | Secondary Keyword | priority
 */

function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Minimal CSV parser — handles double-quoted fields that contain commas. */
function parseCSV(text: string): string[][] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split('\n')
    .map((line) => {
      const cols: string[] = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
          else { inQuote = !inQuote; }
        } else if (ch === ',' && !inQuote) {
          cols.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cols.push(cur.trim());
      return cols;
    });
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let sheetUrl: string;
  try {
    ({ sheetUrl } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!sheetUrl?.trim()) {
    return NextResponse.json({ error: 'sheetUrl is required' }, { status: 400 });
  }

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) {
    return NextResponse.json({ error: 'Invalid Google Sheets URL — could not extract sheet ID' }, { status: 400 });
  }

  // ── Fetch CSV from Google Sheets ──────────────────────────────────────────
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  let csvText: string;
  try {
    const csvRes = await fetch(csvUrl, { redirect: 'follow' });
    if (!csvRes.ok) throw new Error(`Google returned HTTP ${csvRes.status}`);
    csvText = await csvRes.text();
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to fetch sheet: ${err.message}` },
      { status: 502 },
    );
  }

  // ── Parse CSV ─────────────────────────────────────────────────────────────
  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'Sheet appears empty or has no data rows' }, { status: 400 });
  }

  // Match columns by header name (case-insensitive)
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const col = (keywords: string[]) =>
    header.findIndex((h) => keywords.some((k) => h.includes(k)));

  const urlIdx       = col(['new url', 'url', 'page url']);
  const titleIdx     = col(['page title', 'title']);
  const primaryIdx   = col(['primary keyword']);
  const secondaryIdx = col(['secondary keyword']);
  const priorityIdx  = col(['priority']);

  if (urlIdx === -1) {
    return NextResponse.json(
      { error: 'Could not find a URL column in the sheet (expected "New URL" or "Page URL")' },
      { status: 400 },
    );
  }

  const dataRows = rows.slice(1).filter((r) => r[urlIdx]?.trim());

  // ── Bulk insert ───────────────────────────────────────────────────────────
  const db = await getDb();
  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;
  const errorDetails: string[] = [];

  for (const row of dataRows) {
    const pageURL          = row[urlIdx]?.trim() ?? '';
    const pageTitle        = titleIdx     >= 0 ? row[titleIdx]?.trim()     || null : null;
    const primaryKeyword   = primaryIdx   >= 0 ? row[primaryIdx]?.trim()   || null : null;
    const secondaryKws     = secondaryIdx >= 0 ? row[secondaryIdx]?.trim() || null : null;
    const priorityRaw      = priorityIdx  >= 0 ? row[priorityIdx]?.trim()  || null : null;
    const priority         = ['High', 'Medium', 'Low'].includes(priorityRaw ?? '') ? priorityRaw : null;

    if (!pageURL) continue;

    // Basic URL validation
    try { new URL(pageURL); } catch {
      errors++;
      errorDetails.push(`Invalid URL: ${pageURL}`);
      continue;
    }

    try {
      const result = await db.request()
        .input('pageURL',           sql.NVarChar, pageURL)
        .input('pageTitle',         sql.NVarChar, pageTitle)
        .input('primaryKeyword',    sql.NVarChar, primaryKeyword)
        .input('secondaryKeywords', sql.NVarChar, secondaryKws)
        .input('priority',          sql.NVarChar, priority)
        .input('userId',            sql.Int,      session.userId)
        .query(`
          MERGE ClCode_URLs AS tgt
          USING (SELECT @pageURL AS PageURL) AS src
            ON tgt.PageURL = src.PageURL
          WHEN NOT MATCHED THEN
            INSERT (PageURL, PageTitle, PrimaryKeyword, SecondaryKeywords, Priority, CreatedAt, CreatedByUserID)
            VALUES (@pageURL, @pageTitle, @primaryKeyword, @secondaryKeywords, @priority, GETUTCDATE(), @userId);
        `);

      if ((result.rowsAffected?.[0] ?? 0) > 0) inserted++;
      else skipped++;
    } catch (err: any) {
      errors++;
      errorDetails.push(`DB error for ${pageURL}: ${err.message}`);
    }
  }

  return NextResponse.json({
    total: dataRows.length,
    inserted,
    skipped,
    errors,
    errorDetails: errorDetails.slice(0, 10), // cap to first 10
  });
}
