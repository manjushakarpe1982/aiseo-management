import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = await getDb();
    const result = await db.request().query(`
      SELECT DISTINCT ScanCode
      FROM AISEO_PageSEOInputs
      WHERE ScanCode IS NOT NULL
      ORDER BY ScanCode DESC
    `);
    const codes = result.recordset.map((r: { ScanCode: string }) => r.ScanCode);
    return NextResponse.json(codes);
  } catch (err) {
    console.error('scan-codes error:', err);
    return NextResponse.json({ error: 'Failed to fetch scan codes' }, { status: 500 });
  }
}
