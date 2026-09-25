'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { session } from '@/lib/data.ts';
import { env } from '@/lib/env.ts';
import { changePlan, type PlanChange } from '@/lib/plan-change.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { createPortalSession, stripeConfig } from '@/lib/stripe.ts';
import type { FormState } from '../../../actions.ts';

const Choice = z.object({ orgId: z.string().uuid(), plan: z.enum(['team', 'agency']), interval: z.enum(['month', 'year']) });

/** Billing is an owner's decision; the RLS client answers is_owner for the signed-in person. */
async function ownerSession(orgId: string) {
  const { db, user } = await session();
  const owner = await db.rpc('is_owner', { org: orgId });
  return owner.data === true ? { db, user } : undefined;
}

/** "Choose Team" and friends: Checkout, a price change or a refusal with the reason (lib/plan-change.ts decides). */
export async function choosePlan(_prev: FormState, form: FormData): Promise<FormState> {
  const input = Choice.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: 'Choose a plan and a billing period.' };
  const { orgId, plan, interval } = input.data;
  const who = await ownerSession(orgId);
  if (!who) return { error: 'Only owners can change the plan.' };
  const config = stripeConfig();
  if (!config) return { error: 'This server does not take payments yet.' };

  let result: PlanChange;
  try {
    result = await changePlan(createAdminClient(), config, { orgId, plan, interval, email: who.user.email ?? '', billingUrl: `${env.appUrl()}/o/${orgId}/billing` });
  } catch (e) {
    console.error('[billing] choosePlan failed:', e instanceof Error ? e.message : e);
    return { error: 'Stripe did not accept the request. Try again in a minute.' };
  }
  if (result.kind === 'refused') return { error: result.error };
  if (result.kind === 'switched') {
    revalidatePath(`/o/${orgId}/billing`);
    return { done: Date.now(), ok: result.ok };
  }
  // Outside the try: redirect() works by throwing.
  redirect(result.url);
}

/** Stripe's customer portal: card, billing address, VAT id, invoices, cancelling. */
export async function openBillingPortal(form: FormData): Promise<void> {
  const orgId = z.string().uuid().parse(form.get('orgId'));
  const config = stripeConfig();
  if (!config || !(await ownerSession(orgId))) redirect(`/o/${orgId}/billing`);
  const { data: account } = await createAdminClient().from('billing_accounts').select('stripe_customer_id').eq('organization_id', orgId).maybeSingle();
  if (!account) redirect(`/o/${orgId}/billing`);
  let url: string;
  try {
    url = (await createPortalSession(config, { customer: account.stripe_customer_id, returnUrl: `${env.appUrl()}/o/${orgId}/billing` })).url;
  } catch (e) {
    // A live account without a saved portal configuration, or Stripe down: back to the page, not an error screen.
    console.error('[billing] portal failed:', e instanceof Error ? e.message : e);
    redirect(`/o/${orgId}/billing?portal=unavailable`);
  }
  redirect(url);
}
