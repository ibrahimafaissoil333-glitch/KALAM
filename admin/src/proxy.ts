import { NextResponse, type NextRequest } from 'next/server';

/**
 * Redirige vers /login toute page ouverte sans session Supabase.
 * Ce n'est qu'un confort de navigation : l'accès aux données est contrôlé côté Supabase
 * (rôle ADMIN vérifié par chaque fonction SQL et par les règles RLS).
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|_next|favicon.ico|icon.png|logo.png).*)'],
};
