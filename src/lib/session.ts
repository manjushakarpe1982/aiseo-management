import { SignJWT, jwtVerify } from 'jose';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionUser {
  userId: number;
  email: string;
  fullName: string;
  role: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const getSecret = () =>
  new TextEncoder().encode(
    process.env.SESSION_SECRET || 'aiseo-fallback-secret-32-chars!!'
  );

export const COOKIE_NAME = 'aiseo_sess';
export const MAX_AGE = 8 * 60 * 60; // 8 hours

// ─── Sign / Verify ───────────────────────────────────────────────────────────

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: payload.userId as number,
      email: payload.email as string,
      fullName: payload.fullName as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// ─── Extract from request cookie ─────────────────────────────────────────────

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySession(decodeURIComponent(match[1]));
}
