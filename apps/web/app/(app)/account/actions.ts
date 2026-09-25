'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { session } from '@/lib/data.ts';
import { deleteAccountData } from '@/lib/account.ts';
import { stripeConfig } from '@/lib/stripe.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import type { FormState } from '../actions.ts';

/**
 * Deletes the signed-in person's account. Organizations where they are the only member go with it; an organization
 * they alone own but share with others stops the deletion until they make someone else an owner, and one with a
 * running subscription until it is cancelled. Checked before anything is deleted, so a refusal leaves everything as it was.
 */
export async function deleteAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const input = z.object({ confirm: z.string() }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: 'Type your email address to confirm.' };
  const { db, user } = await session();
  if (!user.email || input.data.confirm.trim().toLowerCase() !== user.email.toLowerCase()) return { error: 'Type your email address exactly as shown.' };

  const result = await deleteAccountData(createAdminClient(), stripeConfig(), user.id);
  if (result.error) return { error: result.error };
  await db.auth.signOut();
  redirect('/?account=deleted');
}
