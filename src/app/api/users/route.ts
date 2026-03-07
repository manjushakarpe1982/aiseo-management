import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

// GET /api/users — list all users (admin only)
export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'Admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  try {
    const db = await getDb();
    const result = await db.request().query(`
      SELECT UserID, FullName, Email, Role, IsActive, CreatedAt, LastLoginAt
      FROM ClCode_Users
      ORDER BY CreatedAt DESC
    `);
    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error('users list error:', err);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// POST /api/users — create new user (admin only)
export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'Admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { fullName, email, password, role } = await req.json();

  if (!fullName || !email || !password || !role) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }

  const validRoles = ['Admin', 'Editor', 'Viewer'];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  try {
    const db = await getDb();

    // Check for duplicate email
    const existing = await db.request()
      .input('email', sql.NVarChar, email.trim().toLowerCase())
      .query(`SELECT UserID FROM ClCode_Users WHERE LOWER(Email) = @email`);

    if (existing.recordset.length > 0) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.request()
      .input('fullName', sql.NVarChar, fullName.trim())
      .input('email', sql.NVarChar, email.trim())
      .input('hash', sql.NVarChar, hash)
      .input('role', sql.NVarChar, role)
      .input('createdBy', sql.Int, session.userId)
      .query(`
        INSERT INTO ClCode_Users (FullName, Email, PasswordHash, Role, IsActive, CreatedAt, CreatedByUserID)
        VALUES (@fullName, @email, @hash, @role, 1, GETUTCDATE(), @createdBy)
      `);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('create user error:', err);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
