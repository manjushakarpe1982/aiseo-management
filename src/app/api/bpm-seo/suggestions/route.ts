import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { BPM_PAGES } from '@/lib/bpm-pages';
import { getSessionUser } from '@/lib/session';

const BPM_URLS = BPM_PAGES.map((p) => p.url);

// GET /api/bpm-seo/suggestions
// Returns all ContentImprovement rows for BPM page URLs, plus available scan list.
export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const db = await getDb();

    // ── Improvements for BPM pages ──────────────────────────────────────────
    const r = db.request();
    BPM_URLS.forEach((url, i) => r.input(`url${i}`, sql.NVarChar(500), url));
    const urlIn = BPM_URLS.map((_, i) => `@url${i}`).join(', ');

    const impResult = await r.query(`
      SELECT
        ci.ImprovementID, ci.ScanID, ci.PageURL, ci.FieldName,
        ci.CurrentContent, ci.CurrentCharCount,
        ci.SuggestedContent, ci.SuggestedCharCount,
        ci.IssueType, ci.Reasoning, ci.Priority, ci.ImpactEstimate,
        ci.Status, ci.UserComment, ci.LastAuditedAt,
        u.FullName AS LastAuditedByName,
        s.ScanName
      FROM ClCode_ContentImprovements ci
      LEFT JOIN ClCode_Users u ON u.UserID = ci.LastAuditedByUserID
      LEFT JOIN ClCode_Scans s ON s.ScanID = ci.ScanID
      WHERE ci.PageURL IN (${urlIn})
      ORDER BY
        ci.ScanID DESC,
        CASE ci.Priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
        ci.PageURL
    `);

    // ── Available scans that have BPM improvements ──────────────────────────
    const sr = db.request();
    BPM_URLS.forEach((url, i) => sr.input(`url${i}`, sql.NVarChar(500), url));
    const scansResult = await sr.query(`
      SELECT DISTINCT s.ScanID, s.ScanName, s.StartedAt
      FROM ClCode_ContentImprovements ci
      JOIN ClCode_Scans s ON s.ScanID = ci.ScanID
      WHERE ci.PageURL IN (${urlIn})
      ORDER BY s.StartedAt DESC
    `);

    return NextResponse.json({
      improvements: impResult.recordset,
      scans: scansResult.recordset,
    });
  } catch (err) {
    console.error('bpm-seo/suggestions error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
