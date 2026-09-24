'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server.ts';
import { env } from '@/lib/env.ts';
import { safeNext } from '@/lib/paths.ts';

export interface LoginState {
  step: 'email' | 'code';
  email?: string;
  error?: string;
}

const Email = z.string().trim().toLowerCase().email();

/** Sends one email with a 6-digit code and a link; both sign in, the code also on another device. */
export async function sendCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { step: 'email', error: 'Enter a valid email address.' };
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
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token, type: 'email' });
  if (error) return { step: 'code', email: email.data, error: 'That code is wrong or expired. Request a new one.' };
  await supabase.rpc('claim_invitations');
  redirect(safeNext(form.get('next')));
}
