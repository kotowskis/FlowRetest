import type { createAdminClient } from './supabase/admin.ts';
import { getCheckoutSession, getInvoice, getSubscription, listSubscriptions, subscriptionState, type StripeConfig, type StripeEvent, type StripeInvoice } from './stripe.ts';

type Admin = ReturnType<typeof createAdminClient>;

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  // A plan change waiting for payment (pending_if_incomplete) was paid or dropped.
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
]);
const INVOICE_EVENTS = new Set(['invoice.finalized', 'invoice.paid', 'invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible', 'invoice.updated']);

async function organizationOf(admin: Admin, customer: string): Promise<{ organization_id: string; stripe_subscription_id: string | null; status: string | null } | undefined> {
  const { data } = await admin.from('billing_accounts').select('organization_id, stripe_subscription_id, status').eq('stripe_customer_id', customer).maybeSingle();
  return data ?? undefined;
}

const live = (s: string | null | undefined) => s === 'active' || s === 'trialing' || s === 'past_due';

/**
 * Copies a subscription from Stripe into billing_accounts. Always re-reads it from the API, so events arriving out of
 * order or twice leave the latest state. The organization comes from the customer we created for it; a second live
 * subscription for the same organization (two Checkout tabs) is not taken over and is reported instead, until the
 * tracked one stops.
 */
export async function syncSubscription(admin: Admin, config: StripeConfig, subscriptionId: string): Promise<string> {
  const sub = await getSubscription(config, subscriptionId);
  const account = await organizationOf(admin, sub.customer);
  if (!account) return `subscription ${sub.id}: customer ${sub.customer} belongs to no organization`;
  const state = subscriptionState(sub);
  if (account.stripe_subscription_id && account.stripe_subscription_id !== sub.id && live(account.status)) {
    return live(state.status)
      ? `subscription ${sub.id}: organization ${account.organization_id} already has live subscription ${account.stripe_subscription_id}; cancel and refund one of them in Stripe`
      : `subscription ${sub.id} (${state.status}) ignored; organization keeps ${account.stripe_subscription_id}`;
  }
  const { error } = await admin
    .from('billing_accounts')
    .update({
      stripe_subscription_id: sub.id,
      plan: state.plan,
      status: state.status,
      billing_interval: state.interval,
      current_period_end: state.currentPeriodEnd,
      cancel_at_period_end: state.cancelAtPeriodEnd,
      cancel_at: state.cancelAt,
      ended_at: state.endedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', account.organization_id);
  if (error) throw new Error(`billing_accounts update: ${error.message}`);
  const line = `subscription ${sub.id}: ${state.plan ?? 'unknown plan'} ${state.status}`;
  if (live(state.status)) return line;
  // The tracked subscription stopped while another one of the same customer still charges (two Checkouts, or the
  // older one cancelled as the log above advises): the organization gets the plan it still pays for.
  const other = (await listSubscriptions(config, sub.customer)).find((s) => s.id !== sub.id && live(s.status));
  return other ? `${line}; ${await syncSubscription(admin, config, other.id)}` : line;
}

/**
 * The organization of a completed Checkout whose customer has no billing account yet (saving it failed before the
 * redirect). The session is read back from Stripe and carries the organization id we set as client_reference_id;
 * an organization that already has another customer is left alone.
 */
async function adoptCheckoutCustomer(admin: Admin, config: StripeConfig, sessionId: string): Promise<void> {
  const session = await getCheckoutSession(config, sessionId);
  const org = session.client_reference_id;
  if (!session.customer || !org || !/^[0-9a-f-]{36}$/i.test(org) || (await organizationOf(admin, session.customer))) return;
  const { data: exists } = await admin.from('organizations').select('id').eq('id', org).maybeSingle();
  if (!exists) return;
  await admin.from('billing_accounts').upsert({ organization_id: org, stripe_customer_id: session.customer }, { onConflict: 'organization_id', ignoreDuplicates: true });
}

export function invoiceRow(organizationId: string, inv: StripeInvoice) {
  const iso = (s: number | null) => (s ? new Date(s * 1000).toISOString() : null);
  return {
    id: inv.id,
    organization_id: organizationId,
    number: inv.number,
    status: inv.status ?? 'draft',
    currency: inv.currency,
    total: inv.total,
    amount_paid: inv.amount_paid,
    amount_due: inv.amount_due,
    hosted_invoice_url: inv.hosted_invoice_url,
    invoice_pdf: inv.invoice_pdf,
    period_start: iso(inv.period_start),
    period_end: iso(inv.period_end),
    created_at: new Date(inv.created * 1000).toISOString(),
  };
}

export async function syncInvoice(admin: Admin, config: StripeConfig, invoiceId: string): Promise<string> {
  const inv = await getInvoice(config, invoiceId);
  const account = await organizationOf(admin, inv.customer);
  if (!account) return `invoice ${inv.id}: customer ${inv.customer} belongs to no organization`;
  // Drafts change until they are finalized and are not bills yet.
  if (inv.status === 'draft') return `invoice ${inv.id}: draft skipped`;
  const { error } = await admin.from('invoices').upsert(invoiceRow(account.organization_id, inv));
  if (error) throw new Error(`invoices upsert: ${error.message}`);
  return `invoice ${inv.id}: ${inv.status}`;
}

/** Applies one webhook event; returns a line for stripe_events. Throws when Stripe should retry the delivery. */
export async function handleStripeEvent(admin: Admin, config: StripeConfig, event: StripeEvent): Promise<string> {
  const object = event.data.object;
  if (event.type === 'checkout.session.completed') {
    if (!object.subscription) return 'checkout without a subscription';
    if (object.id) await adoptCheckoutCustomer(admin, config, object.id);
    return syncSubscription(admin, config, object.subscription);
  }
  if (SUBSCRIPTION_EVENTS.has(event.type) && object.id) return syncSubscription(admin, config, object.id);
  if (INVOICE_EVENTS.has(event.type) && object.id) return syncInvoice(admin, config, object.id);
  return 'ignored';
}

/**
 * The success page of Checkout syncs the session right away, so the plan shows without waiting for the webhook
 * (which may not reach a developer's machine at all). The session must belong to this organization's customer.
 */
export async function syncCheckout(admin: Admin, config: StripeConfig, organizationId: string, sessionId: string): Promise<boolean> {
  const session = await getCheckoutSession(config, sessionId);
  const { data: account } = await admin.from('billing_accounts').select('stripe_customer_id').eq('organization_id', organizationId).maybeSingle();
  if (!account || session.customer !== account.stripe_customer_id || !session.subscription) return false;
  await syncSubscription(admin, config, session.subscription);
  return true;
}
