import { NextResponse } from 'next/server';
import { API_URL, accessToken, refreshSession, sameOrigin } from '@/lib/server-session';

/**
 * Proxy vers l'API : ajoute le jeton admin lu dans le cookie httpOnly.
 * Seules les routes /admin/*, /me et /catalog/* sont relayées.
 */
const ALLOWED = /^(admin(\/.*)?|me|catalog\/.*)$/;

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join('/');
  if (!ALLOWED.test(joined)) return NextResponse.json({ message: 'Route non autorisée.' }, { status: 404 });
  if (req.method !== 'GET' && !sameOrigin(req)) return NextResponse.json({ message: 'Origine refusée.' }, { status: 403 });

  const url = `${API_URL}/v1/${joined}${new URL(req.url).search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.from(await req.arrayBuffer());
  const send = (token: string | null) => {
    const headers: Record<string, string> = {};
    const ct = req.headers.get('content-type');
    if (ct) headers['content-type'] = ct;
    if (token) headers.authorization = `Bearer ${token}`;
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) headers['x-forwarded-for'] = fwd;
    return fetch(url, { method: req.method, headers, body, cache: 'no-store' });
  };

  let token = await accessToken();
  if (!token) return NextResponse.json({ message: 'Session expirée.' }, { status: 401 });
  let res = await send(token);
  if (res.status === 401) {
    token = await refreshSession();
    if (!token) return NextResponse.json({ message: 'Session expirée.' }, { status: 401 });
    res = await send(token);
  }
  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), { status: res.status, headers });
}

export { forward as GET, forward as POST, forward as PATCH, forward as PUT, forward as DELETE };
