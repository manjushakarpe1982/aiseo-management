import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb, sql } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

// PATCH /api/users/[id] — update user (admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'Admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await req.json();
  const { isActive, role, password } = body;

  // Prevent admin from deactivating themselves
  if (id === session.userId && isActive === false) {
    return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 });
  }

  try {
    const db = await getDb();

    if (typeof isActive === 'boolean') {
      await db.request()
        .input('id', sql.Int, id)
        .input('isActive', sql.Bit, isActive ? 1 : 0)
        .query(`UPDATE ClCode_Users SET IsActive = @isActive WHERE UserID = @id`);
    }

    if (role) {
      const validRoles = ['Admin', 'Editor', 'Viewer'];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      await db.request()
        .input('id', sql.Int, id)
        .input('role', sql.NVarChar, role)
        .query(`UPDATE ClCode_Users SET Role = @role WHERE UserID = @id`);
    }

    if (password) {
      if (password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      const hash = await bcrypt.hash(password, 10);
      await db.request()
        .input('id', sql.Int, id)
        .input('hash', sql.NVarChar, hash)
        .query(`UPDATE ClCode_Users SET PasswordHash = @hash WHERE UserID = @id`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('update user error:', err);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
