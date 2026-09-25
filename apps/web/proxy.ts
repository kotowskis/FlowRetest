import type { NextRequest } from 'next/server';
import { contentSecurityPolicy } from './lib/csp.ts';
import { updateSession } from './lib/supabase/proxy.ts';

export async function proxy(request: NextRequest) {
  // A fresh nonce per page request; Next reads it from the request's CSP header and puts it on its scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  const response = await updateSession(request, requestHeaders);
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // The upload API authenticates with a workspace token, not a session; static files need nothing.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
