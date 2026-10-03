import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API_URL, REFRESH_COOKIE, clearSession, sameOrigin } from '@/lib/server-session';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Origine refusée.' }, { status: 403 });
  const refresh = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refresh) {
    await fetch(`${API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => undefined);
  }
  await clearSession();
  return new NextResponse(null, { status: 204 });
}
