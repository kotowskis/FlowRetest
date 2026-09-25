/**
 * "Choose Team" and friends, without the session and the redirect: which way a plan change goes (Checkout, a price
 * change on the live subscription, or a refusal with the reason). Kept apart from the server action so the
 * integration tests drive the same code against the fake Stripe.
 */
import type { createAdminClient } from './supabase/admin.ts';
import { syncSubscription } from './billing.ts';
import { changeSubscriptionPrice, createCheckoutSession, createCustomer, getSubscription, priceFor, type Interval, type PaidPlan, type StripeConfig } from './stripe.ts';

type Admin = ReturnType<typeof createAdminClient>;

export type PlanChange = { kind: 'checkout'; url: string } | { kind: 'switched'; ok: string } | { kind: 'refused'; error: string };

/** The organization's Stripe customer, created on first use; a concurrent second request reuses the stored one. */
export async function customerFor(admin: Admin, config: StripeConfig, orgId: string, email: string): Promise<string> {
  const { data: existing } = await admin.from('billing_accounts').select('stripe_customer_id').eq('organization_id', orgId).maybeSingle();
  if (existing) return existing.stripe_customer_id;
  const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).single();
  const customer = await createCustomer(config, { organizationId: orgId, name: org?.name ?? orgId, email });
  // A Checkout for a customer the database does not know would be paid and never applied, so a failed save stops here.
  const saved = await admin.from('billing_accounts').upsert({ organization_id: orgId, stripe_customer_id: customer.id }, { onConflict: 'organization_id', ignoreDuplicates: true });
  if (saved.error) throw new Error(`billing_accounts: ${saved.error.message}`);
  const { data: stored, error } = await admin.from('billing_accounts').select('stripe_customer_id').eq('organization_id', orgId).single();
  if (error || !stored) throw new Error(`billing_accounts: ${error?.message ?? 'row missing after save'}`);
  return stored.stripe_customer_id;
}

const date = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Without a subscription the owner goes to Stripe Checkout. With a live one the price changes at once and the
 * difference is invoiced, after checking that the organization fits the new plan. A subscription that is failing,
 * paused, unpaid or scheduled to end is sorted out in the Stripe portal first: a second Checkout would start a second
 * subscription next to it, and a price change would silently undo the scheduled end.
 */
export async function changePlan(admin: Admin, config: StripeConfig, input: { orgId: string; plan: PaidPlan; interval: Interval; email: string; billingUrl: string }): Promise<PlanChange> {
  const { orgId, plan, interval } = input;
  const { data: account } = await admin.from('billing_accounts').select('stripe_subscription_id, plan, billing_interval, status, cancel_at, cancel_at_period_end').eq('organization_id', orgId).maybeSingle();
  const status = account?.stripe_subscription_id ? account.status : null;

  if (status === 'unpaid' || status === 'paused' || status === 'incomplete') {
    return { kind: 'refused', error: `The subscription is ${status}. Pay the open invoice or update the card in the Stripe portal (Payment details) before choosing a plan.` };
  }
  if (status === 'past_due') return { kind: 'refused', error: 'The last payment failed. Update the card and pay the open invoice in the Stripe portal, then change the plan.' };

  if (account && (status === 'active' || status === 'trialing')) {
    if (account.cancel_at || account.cancel_at_period_end) {
      const end = account.cancel_at ? ` on ${date(account.cancel_at)}` : ' at the end of the period';
      return { kind: 'refused', error: `The subscription is set to end${end}. Renew it in the Stripe portal first, then change the plan.` };
    }
    if (account.plan === plan && account.billing_interval === interval) return { kind: 'refused', error: 'This is the current plan.' };
    const [{ data: target }, { data: usage }] = await Promise.all([admin.from('plans').select('*').eq('id', plan).single(), admin.rpc('org_plan', { org: orgId })]);
    const used = usage?.[0];
    if (!target || !used) return { kind: 'refused', error: 'Could not read the plan limits.' };
    if (target.workspaces !== null && used.workspaces_used > target.workspaces) return { kind: 'refused', error: `${target.name} includes ${target.workspaces} workspaces and this organization has ${used.workspaces_used}. Delete some first.` };
    if (used.seats_used > target.seats) return { kind: 'refused', error: `${target.name} includes ${target.seats} seats and this organization uses ${used.seats_used}, counting invitations. Remove someone first.` };
    const price = await priceFor(config, plan, interval);
    const subscription = await getSubscription(config, account.stripe_subscription_id as string);
    const updated = await changeSubscriptionPrice(config, subscription, price.id);
    await syncSubscription(admin, config, subscription.id);
    if (updated.pending_update) return { kind: 'refused', error: `Stripe could not charge the difference for ${target.name}, so the plan did not change. Pay the open invoice in the Stripe portal and the new plan starts right away.` };
    return { kind: 'switched', ok: `Switched to ${target.name}, billed ${interval === 'month' ? 'monthly' : 'yearly'}. The prorated difference is on a new invoice.` };
  }

  const customer = await customerFor(admin, config, orgId, input.email);
  const price = await priceFor(config, plan, interval);
  const checkout = await createCheckoutSession(config, {
    customer,
    price: price.id,
    organizationId: orgId,
    successUrl: `${input.billingUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${input.billingUrl}?checkout=cancelled`,
  });
  return checkout.url ? { kind: 'checkout', url: checkout.url } : { kind: 'refused', error: 'Stripe returned no checkout page.' };
}
