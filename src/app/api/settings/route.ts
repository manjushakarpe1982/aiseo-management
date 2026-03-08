import { NextRequest, NextResponse } from 'next/server';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/** Keys whose stored value is masked in GET responses (only last 6 chars shown). */
const SECRET_KEYS = ['ANTHROPIC_API_KEY'];

function maskValue(key: string, value: string): string {
  if (!SECRET_KEYS.includes(key)) return value;
  if (!value) return '';
  return value.length > 6 ? `...${value.slice(-6)}` : '******';
}

// ── GET /api/settings ─────────────────────────────────────────────────────
// Returns all settings. Secret values are masked — use isSet to check if
// a key has been configured.
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = await getDb();
    const result = await db.request().query(
      `SELECT SettingKey, SettingValue, Description, UpdatedAt
       FROM ClCode_Settings
       ORDER BY SettingKey`
    );

    const settings = result.recordset.map((row: {
      SettingKey: string;
      SettingValue: string;
      Description: string | null;
      UpdatedAt: Date | null;
    }) => ({
      key:         row.SettingKey,
      value:       maskValue(row.SettingKey, row.SettingValue ?? ''),
      isSet:       !!(row.SettingValue),
      description: row.Description,
      updatedAt:   row.UpdatedAt,
    }));

    return NextResponse.json({ settings });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/settings]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── PUT /api/settings ─────────────────────────────────────────────────────
// Updates the value for a single setting key.
// Body: { key: string, value: string }
export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const { key, value } = body as { key?: string; value?: string };

    if (!key)            return NextResponse.json({ error: 'key is required' },   { status: 400 });
    if (value === undefined || value === null)
                         return NextResponse.json({ error: 'value is required' }, { status: 400 });

    const db = await getDb();

    // Upsert: update if exists, insert if not
    const result = await db.request()
      .input('key',    sql.NVarChar, key)
      .input('value',  sql.NVarChar, value)
      .input('userId', sql.Int,      session.userId)
      .query(`
        IF EXISTS (SELECT 1 FROM ClCode_Settings WHERE SettingKey = @key)
          UPDATE ClCode_Settings
             SET SettingValue    = @value,
                 UpdatedAt       = GETUTCDATE(),
                 UpdatedByUserID = @userId
           WHERE SettingKey = @key
        ELSE
          INSERT INTO ClCode_Settings (SettingKey, SettingValue, UpdatedAt, UpdatedByUserID)
          VALUES (@key, @value, GETUTCDATE(), @userId)
      `);

    console.log(`[PUT /api/settings] User ${session.userId} updated setting: ${key}`);
    return NextResponse.json({ ok: true });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[PUT /api/settings]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
