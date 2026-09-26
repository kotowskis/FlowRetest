'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { env } from '@/lib/env.ts';
import { safeNext } from '@/lib/paths.ts';
import { isTestAccount, testMode } from '@/lib/test-mode.ts';

export interface LoginState {
  step: 'email' | 'code';
  email?: string;
  error?: string;
}

const Email = z.string().trim().toLowerCase().email();

const TOO_MANY = 'Too many attempts. Wait 15 minutes and try again.';

/**
 * Supabase Auth sees this server's address for every visitor, so its own per-IP limits cannot tell people apart.
 * The limits per address and per client are counted in the database (note_sign_in_attempt) with the visitor's IP
 * from the proxy in front of the app. A failed check lets the attempt through: a database hiccup must not lock
 * everyone out of signing in.
 */
async function allowed(kind: 'send' | 'verify', email: string): Promise<boolean> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  const { data, error } = await createAdminClient().rpc('note_sign_in_attempt', { p_kind: kind, p_email: email, p_ip: ip });
  if (error) console.error('[login] note_sign_in_attempt failed:', error.message);
  return error ? true : data === true;
}

/** Sends one email with a 6-digit code and a link; both sign in, the code also on another device. */
export async function sendCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { step: 'email', error: 'Enter a valid email address.' };
  if (!(await allowed('send', email.data))) return { step: 'email', email: email.data, error: TOO_MANY };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email: email.data, options: { shouldCreateUser: true, emailRedirectTo: `${env.appUrl()}/auth/confirm` } });
  if (error) return { step: 'email', email: email.data, error: error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'Could not send the code. Try again.' };
  return { step: 'code', email: email.data };
}

export async function verifyCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = Email.safeParse(form.get('email'));
  const token = String(form.get('code') ?? '').replace(/\s+/g, '');
  if (!email.success) return { step: 'email', error: 'Enter your email again.' };
  if (!/^\d{6}$/.test(token)) return { step: 'code', email: email.data, error: 'The code has 6 digits.' };
  if (!(await allowed('verify', email.data))) return { step: 'code', email: email.data, error: TOO_MANY };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token, type: 'email' });
  if (error) return { step: 'code', email: email.data, error: 'That code is wrong or expired. Request a new one.' };
  await supabase.rpc('claim_invitations');
  redirect(safeNext(form.get('next')));
}

/**
 * Test mode only (lib/test-mode.ts): signs in as one of the seeded accounts without an email, through the same
 * token_hash verification as the emailed link. Any other address, or a server outside test mode, gets the login page.
 */
export async function signInAsTestAccount(form: FormData): Promise<void> {
  const email = String(form.get('email') ?? '');
  if (!testMode() || !isTestAccount(email)) redirect('/login');
  const link = await createAdminClient().auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) redirect('/login?error=test-account');
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'email' });
  if (error) redirect('/login?error=test-account');
  await supabase.rpc('claim_invitations');
  redirect(safeNext(form.get('next')));
}
