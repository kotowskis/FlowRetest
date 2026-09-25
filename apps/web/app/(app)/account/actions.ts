'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { session } from '@/lib/data.ts';
import { accountDeletionPlan } from '@/lib/account.ts';
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

  const admin = createAdminClient();
  const { data: mine, error: mineError } = await admin.from('members').select('organization_id, role').eq('user_id', user.id);
  if (mineError) return { error: 'Could not read your organizations.' };
  const orgIds = (mine ?? []).map((m) => m.organization_id);
  const [{ data: everyone, error: membersError }, { data: orgs }, { data: billing }] = await Promise.all([
    admin.from('members').select('organization_id, user_id, role').in('organization_id', orgIds),
    admin.from('organizations').select('id, name').in('id', orgIds),
    admin.from('billing_accounts').select('organization_id, status, cancel_at_period_end, cancel_at').in('organization_id', orgIds),
  ]);
  if (membersError) return { error: 'Could not read your organizations.' };
  const plan = accountDeletionPlan(user.id, everyone ?? [], orgs ?? [], billing ?? []);
  if (plan.blocked.length > 0) return { error: plan.blocked.join(' ') };

  for (const orgId of plan.deleteOrganizations) {
    const { error } = await admin.from('organizations').delete().eq('id', orgId);
    if (error) return { error: 'Could not delete one of your organizations; nothing else was deleted after it. Try again.' };
  }
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: 'Could not delete the account. Try again or write to us.' };
  await db.auth.signOut();
  redirect('/?account=deleted');
}
