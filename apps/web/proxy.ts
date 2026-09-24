import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/proxy.ts';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // The upload API authenticates with a workspace token, not a session; static files need nothing.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
