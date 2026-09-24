import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server.ts';
import { env } from '@/lib/env.ts';

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${env.appUrl()}/login`, { status: 303 });
}
