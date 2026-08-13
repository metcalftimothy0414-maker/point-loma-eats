import { NextResponse, type NextRequest } from 'next/server';

/**
 * HTTP Basic Auth gate. Single-founder tool, single shared credential —
 * see lib/supabase-admin.ts for why this stands in for real auth here.
 */
export function proxy(request: NextRequest) {
  const user = process.env.ADMIN_BASIC_AUTH_USER;
  const password = process.env.ADMIN_BASIC_AUTH_PASSWORD;

  if (!user || !password) {
    return new NextResponse('Admin auth is not configured (ADMIN_BASIC_AUTH_USER/PASSWORD)', { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    const [providedUser, providedPassword] = atob(authHeader.slice('Basic '.length)).split(':');
    if (providedUser === user && providedPassword === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Point Loma Eats Admin"' },
  });
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
