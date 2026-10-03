import { NextResponse } from 'next/server';
import { API_URL, sameOrigin, setSession } from '@/lib/server-session';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Origine refusée.' }, { status: 403 });
  const { email, password } = await req.json().catch(() => ({}));
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify({ email, password, platform: 'web', deviceKey: 'admin-web', deviceLabel: 'Administration web' }),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    return NextResponse.json({ message: message ?? 'Connexion impossible.' }, { status: res.status });
  }
  if (body.user?.role !== 'ADMIN') {
    // Même message qu'un mauvais mot de passe : on ne révèle pas qu'un compte client existe.
    return NextResponse.json({ message: 'E-mail ou mot de passe incorrect.' }, { status: 401 });
  }
  await setSession(body.accessToken, body.refreshToken, body.expiresIn);
  return NextResponse.json({ user: body.user });
}
