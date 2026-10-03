import { NextResponse, type NextRequest } from 'next/server';

/** Redirige vers /login toute page de l'admin ouverte sans session. */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has('folio_admin_rt') || req.cookies.has('folio_admin_at');
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|api|_next|favicon.ico).*)'],
};
