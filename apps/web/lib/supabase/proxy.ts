import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Paths that need a session; everything else (login, auth callbacks, the upload API) is public. */
const PROTECTED = ['/orgs', '/o/', '/w/', '/runs/', '/account'];

/** Refreshes the session cookie on every request and sends signed-out visitors of app pages to /login. */
export async function updateSession(request: NextRequest, requestHeaders: Headers = request.headers): Promise<NextResponse> {
  // requestHeaders carries the CSP nonce to the page render (proxy.ts).
  const forward = () => NextResponse.next({ request: { headers: requestHeaders } });
  let response = forward();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(p));
  if (!url || !key) return isProtected ? NextResponse.redirect(new URL('/login', request.url)) : response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        // Refreshed cookies go to the render too: copy them into the forwarded headers.
        requestHeaders.set('cookie', request.cookies.toString());
        response = forward();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        // A response that sets session cookies must never be cached for another visitor.
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user && isProtected) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', path);
    return NextResponse.redirect(login);
  }
  if (data.user && path === '/login') return NextResponse.redirect(new URL('/orgs', request.url));
  return response;
}
