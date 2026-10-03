import 'server-only';
import { cookies } from 'next/headers';

/**
 * Les jetons de l'API restent côté serveur, dans des cookies httpOnly + SameSite=Strict.
 * Le navigateur n'y a jamais accès en JavaScript.
 */
export const API_URL = process.env.API_URL ?? 'http://localhost:3000';
export const ACCESS_COOKIE = 'folio_admin_at';
export const REFRESH_COOKIE = 'folio_admin_rt';

const base = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/' };

export async function setSession(accessToken: string, refreshToken: string, expiresIn: number) {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: expiresIn });
  // Session admin plus courte que celle des clients : 12 h.
  jar.set(REFRESH_COOKIE, refreshToken, { ...base, maxAge: 12 * 3600 });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

/** Renouvelle le jeton d'accès. Renvoie null si la session est terminée. */
export async function refreshSession(): Promise<string | null> {
  const jar = await cookies();
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;
  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
    cache: 'no-store',
  });
  if (!res.ok) {
    await clearSession();
    return null;
  }
  const s = await res.json();
  if (s.user?.role !== 'ADMIN') {
    await clearSession();
    return null;
  }
  await setSession(s.accessToken, s.refreshToken, s.expiresIn);
  return s.accessToken;
}

export async function accessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCESS_COOKIE)?.value ?? (await refreshSession());
}

/** Protection CSRF : toute requête qui modifie des données doit venir de la même origine. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
