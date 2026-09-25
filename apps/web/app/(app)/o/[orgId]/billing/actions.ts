'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { session } from '@/lib/data.ts';
import { env } from '@/lib/env.ts';
import { syncSubscription } from '@/lib/billing.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { changeSubscriptionPrice, createCheckoutSession, createCustomer, createPortalSession, getSubscription, priceFor, stripeConfig, type StripeConfig } from '@/lib/stripe.ts';
import type { FormState } from '../../../actions.ts';

type Admin = ReturnType<typeof createAdminClient>;

const Choice = z.object({ orgId: z.string().uuid(), plan: z.enum(['team', 'agency']), interval: z.enum(['month', 'year']) });
const live = (status: string | null | undefined) => status === 'active' || status === 'trialing' || status === 'past_due';

/** Billing is an owner's decision; the RLS client answers is_owner for the signed-in person. */
async function ownerSession(orgId: string) {
  const { db, user } = await session();
  const owner = await db.rpc('is_owner', { org: orgId });
  return owner.data === true ? { db, user } : undefined;
}

/** The organization's Stripe customer, created on first use; a concurrent second request reuses the stored one. */
async function customerFor(admin: Admin, config: StripeConfig, orgId: string, email: string): Promise<string> {
  const { data: existing } = await admin.from('billing_accounts').select('stripe_customer_id').eq('organization_id', orgId).maybeSingle();
  if (existing) return existing.stripe_customer_id;
  const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).single();
  const customer = await createCustomer(config, { organizationId: orgId, name: org?.name ?? orgId, email });
  await admin.from('billing_accounts').upsert({ organization_id: orgId, stripe_customer_id: customer.id }, { onConflict: 'organization_id', ignoreDuplicates: true });
  const { data: stored } = await admin.from('billing_accounts').select('stripe_customer_id').eq('organization_id', orgId).single();
  return stored?.stripe_customer_id ?? customer.id;
}

/**
 * "Choose Team" and friends. Without a live subscription the owner goes to Stripe Checkout; with one, the subscription
 * moves to the new price at once (prorated), after checking that the organization fits the new plan's limits.
 */
export async function choosePlan(_prev: FormState, form: FormData): Promise<FormState> {
  const input = Choice.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: 'Choose a plan and a billing period.' };
  const { orgId, plan, interval } = input.data;
  const who = await ownerSession(orgId);
  if (!who) return { error: 'Only owners can change the plan.' };
  const config = stripeConfig();
  if (!config) return { error: 'This server does not take payments yet.' };
  const admin = createAdminClient();
  const { data: account } = await admin.from('billing_accounts').select('stripe_subscription_id, plan, billing_interval, status').eq('organization_id', orgId).maybeSingle();
  const billingUrl = `${env.appUrl()}/o/${orgId}/billing`;

  let checkoutUrl: string | null = null;
  try {
    if (account?.stripe_subscription_id && live(account.status)) {
      if (account.plan === plan && account.billing_interval === interval) return { error: 'This is the current plan.' };
      // A card that is already failing must not buy a bigger plan on credit: pay the open invoice first.
      if (account.status === 'past_due') return { error: 'The last payment failed. Update the card and pay the open invoice in the Stripe portal, then change the plan.' };
      const [{ data: target }, { data: usage }] = await Promise.all([admin.from('plans').select('*').eq('id', plan).single(), admin.rpc('org_plan', { org: orgId })]);
      const used = usage?.[0];
      if (!target || !used) return { error: 'Could not read the plan limits.' };
      if (target.workspaces !== null && used.workspaces_used > target.workspaces) return { error: `${target.name} includes ${target.workspaces} workspaces and this organization has ${used.workspaces_used}. Delete some first.` };
      if (used.seats_used > target.seats) return { error: `${target.name} includes ${target.seats} seats and this organization uses ${used.seats_used}, counting invitations. Remove someone first.` };
      const price = await priceFor(config, plan, interval);
      const subscription = await getSubscription(config, account.stripe_subscription_id);
      const updated = await changeSubscriptionPrice(config, subscription, price.id);
      await syncSubscription(admin, config, subscription.id);
      revalidatePath(`/o/${orgId}/billing`);
      if (updated.pending_update) return { error: `Stripe could not charge the difference for ${target.name}, so the plan did not change. Pay the open invoice in the Stripe portal and the new plan starts right away.` };
      return { done: Date.now(), ok: `Switched to ${target.name}, billed ${interval === 'month' ? 'monthly' : 'yearly'}. The prorated difference is on a new invoice.` };
    }
    const customer = await customerFor(admin, config, orgId, who.user.email ?? '');
    const price = await priceFor(config, plan, interval);
    const checkout = await createCheckoutSession(config, {
      customer,
      price: price.id,
      organizationId: orgId,
      successUrl: `${billingUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${billingUrl}?checkout=cancelled`,
    });
    checkoutUrl = checkout.url;
  } catch (e) {
    console.error('[billing] choosePlan failed:', e instanceof Error ? e.message : e);
    return { error: 'Stripe did not accept the request. Try again in a minute.' };
  }
  if (!checkoutUrl) return { error: 'Stripe returned no checkout page.' };
  // Outside the try: redirect() works by throwing.
  redirect(checkoutUrl);
}

/** Stripe's customer portal: card, billing address, VAT id, invoices, cancelling. */
export async function openBillingPortal(form: FormData): Promise<void> {
  const orgId = z.string().uuid().parse(form.get('orgId'));
  const config = stripeConfig();
  if (!config || !(await ownerSession(orgId))) redirect(`/o/${orgId}/billing`);
  const { data: account } = await createAdminClient().from('billing_accounts').select('stripe_customer_id').eq('organization_id', orgId).maybeSingle();
  if (!account) redirect(`/o/${orgId}/billing`);
  const portal = await createPortalSession(config, { customer: account.stripe_customer_id, returnUrl: `${env.appUrl()}/o/${orgId}/billing` });
  redirect(portal.url);
}
