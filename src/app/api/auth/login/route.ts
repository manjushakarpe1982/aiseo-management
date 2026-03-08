import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb, sql } from '@/lib/db';
import { signSession, COOKIE_NAME, MAX_AGE } from '@/lib/session';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await db.request()
      .input('email', sql.NVarChar, email.trim().toLowerCase())
      .query(`
        SELECT UserID, FullName, Email, PasswordHash, Role, IsActive
        FROM ClCode_Users
        WHERE LOWER(Email) = @email
      `);

    const user = result.recordset[0];

    if (!user || !user.IsActive) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.PasswordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Update LastLoginAt
    await db.request()
      .input('id', sql.Int, user.UserID)
      .query(`UPDATE ClCode_Users SET LastLoginAt = GETUTCDATE() WHERE UserID = @id`);

    // Sign JWT session
    const token = await signSession({
      userId: user.UserID,
      email: user.Email,
      fullName: user.FullName,
      role: user.Role,
    });

    const res = NextResponse.json({ success: true, fullName: user.FullName, role: user.Role });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: MAX_AGE,
      path: '/',
    });
    return res;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
