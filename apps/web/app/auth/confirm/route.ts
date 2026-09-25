import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server.ts';
import { env } from '@/lib/env.ts';

/** The link in the sign-in email. token_hash needs no PKCE verifier, so it works in another browser too. */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  // The sign-in email is the only link this route serves; recovery, invite and email-change links are not used.
  const type: EmailOtpType = 'email';
  if (tokenHash && (request.nextUrl.searchParams.get('type') ?? 'email') === 'email') {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      await supabase.rpc('claim_invitations');
      return NextResponse.redirect(`${env.appUrl()}/orgs`);
    }
  }
  return NextResponse.redirect(`${env.appUrl()}/login?error=link`);
}
