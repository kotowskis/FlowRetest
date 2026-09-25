/**
 * The plan change the Billing page runs (lib/plan-change.ts), end to end against the fake Stripe and the running app
 * that receives its webhooks: Checkout, a paid switch, a switch whose payment fails, a subscription scheduled to end
 * or unpaid, two live subscriptions, and a Checkout whose customer the database never stored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { changePlan } from '../../lib/plan-change.ts';
import { stripeConfig, type StripeConfig } from '../../lib/stripe.ts';
import { admin, appMissing, appUrl, supabaseMissing, user, mustRun } from './helpers.ts';

const stripeUrl = process.env.STRIPE_API_URL ?? '';
const fakeBase = stripeUrl.replace(/\/stripe$/, '');
async function missing(): Promise<string | undefined> {
  const base = (await supabaseMissing()) ?? (await appMissing());
  if (base) return base;
  if (!stripeUrl || !process.env.STRIPE_WEBHOOK_SECRET) return 'no fake Stripe in .env.local (node scripts/fake-services.mjs init)';
  try {
    await fetch(`${fakeBase}/__stripe`, { signal: AbortSignal.timeout(2000) });
  } catch {
    return `fake services not reachable at ${fakeBase}`;
  }
  return undefined;
}
const skip = mustRun(await missing());
const config = stripeConfig() as StripeConfig;

async function org(): Promise<{ id: string; email: string }> {
  const owner = await user('plan-owner');
  const created = await owner.db.rpc('create_organization', { p_name: `Plan ${randomUUID().slice(0, 6)}` });
  assert.ifError(created.error);
  return { id: created.data as string, email: owner.email };
}

const change = (o: { id: string; email: string }, plan: 'team' | 'agency', interval: 'month' | 'year') =>
  changePlan(admin(), config, { orgId: o.id, plan, interval, email: o.email, billingUrl: `${appUrl}/o/${o.id}/billing` });

async function account(orgId: string) {
  return (await admin().from('billing_accounts').select('*').eq('organization_id', orgId).single()).data!;
}

/** Pays a Checkout page of the fake; the fake then delivers signed webhooks to the app. */
async function pay(url: string): Promise<void> {
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 302);
}

const form = (params: Record<string, string>) => ({ method: 'POST', headers: { authorization: `Bearer ${config.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });

const control = (path: string, body: unknown) => fetch(`${fakeBase}/__stripe/${path}`, { method: 'POST', body: JSON.stringify(body) });

test('Checkout, then a switch that is paid at once, then one whose payment fails and stays pending', { skip }, async () => {
  const o = await org();
  const first = await change(o, 'team', 'month');
  assert.equal(first.kind, 'checkout');
  await pay((first as { url: string }).url);
  assert.deepEqual([(await account(o.id)).plan, (await account(o.id)).billing_interval], ['team', 'month']);

  const up = await change(o, 'agency', 'year');
  assert.equal(up.kind, 'switched', JSON.stringify(up));
  const after = await account(o.id);
  assert.deepEqual([after.plan, after.billing_interval, after.previous_plan], ['agency', 'year', 'team']);

  // The card starts failing: the smaller plan does not apply until its invoice is paid.
  await control(`customers/${after.stripe_customer_id}`, { fail_payments: true });
  const failed = await change(o, 'team', 'year');
  assert.equal(failed.kind, 'refused');
  assert.match((failed as { error: string }).error, /could not charge the difference/);
  assert.equal((await account(o.id)).plan, 'agency');
});

test('a subscription scheduled to end, unpaid or past due is sent to the portal, not to a second Checkout', { skip }, async () => {
  const o = await org();
  await pay(((await change(o, 'team', 'month')) as { url: string }).url);
  const sub = (await account(o.id)).stripe_subscription_id as string;

  // Flexible billing mode: the portal sets cancel_at and leaves cancel_at_period_end false.
  const end = Math.floor(Date.now() / 1000) + 20 * 86400;
  await control(`subscriptions/${sub}`, { cancel_at: end });
  assert.equal(new Date((await account(o.id)).cancel_at as string).getTime(), end * 1000);
  const cancelling = await change(o, 'agency', 'month');
  assert.match((cancelling as { error: string }).error, /set to end on/);

  await control(`subscriptions/${sub}`, { cancel_at: null, status: 'unpaid' });
  const unpaid = await change(o, 'agency', 'month');
  assert.equal(unpaid.kind, 'refused');
  assert.match((unpaid as { error: string }).error, /unpaid/);

  await control(`subscriptions/${sub}`, { status: 'past_due' });
  assert.match(((await change(o, 'agency', 'month')) as { error: string }).error, /last payment failed/);

  // A subscription that still charges blocks deleting the organization; one scheduled to end does not.
  await control(`subscriptions/${sub}`, { status: 'active' });
  assert.equal((await admin().from('organizations').delete().eq('id', o.id)).error?.hint, 'subscription');
  await control(`subscriptions/${sub}`, { cancel_at: end });
  assert.ifError((await admin().from('organizations').delete().eq('id', o.id)).error);
});

test('when the tracked subscription ends, a second live one of the same customer takes over', { skip }, async () => {
  const o = await org();
  // A double click gets the same Checkout page.
  const a = (await change(o, 'team', 'month')) as { url: string };
  assert.equal(((await change(o, 'team', 'month')) as { url: string }).url, a.url);
  // A second tab opened later is a second session; both get paid.
  const customer = (await admin().from('billing_accounts').select('stripe_customer_id').eq('organization_id', o.id).single()).data!.stripe_customer_id;
  const b = (await (await fetch(`${stripeUrl}/v1/checkout/sessions`, form({
    mode: 'subscription', customer, 'line_items[0][price]': 'price_team_monthly', 'line_items[0][quantity]': '1', success_url: `${appUrl}/ok`, cancel_url: `${appUrl}/no`,
  }))).json()) as { url: string };
  await pay(a.url);
  const tracked = (await account(o.id)).stripe_subscription_id as string;
  await pay(b.url);
  assert.equal((await account(o.id)).stripe_subscription_id, tracked, 'the second one is reported, not taken over');

  await control(`subscriptions/${tracked}`, { status: 'canceled' });
  const now = await account(o.id);
  assert.notEqual(now.stripe_subscription_id, tracked);
  assert.deepEqual([now.plan, now.status], ['team', 'active']);
});

test('a paid Checkout whose customer was never stored is applied through client_reference_id', { skip }, async () => {
  const o = await org();
  const customer = (await (await fetch(`${stripeUrl}/v1/customers`, form({ name: 'Lost', email: o.email }))).json()) as { id: string };
  const session = (await (await fetch(`${stripeUrl}/v1/checkout/sessions`, form({
    mode: 'subscription', customer: customer.id, client_reference_id: o.id, 'line_items[0][price]': 'price_team_monthly', 'line_items[0][quantity]': '1',
    success_url: `${appUrl}/o/${o.id}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${appUrl}/o/${o.id}/billing`,
  }))).json()) as { url: string };
  await pay(session.url);
  const acc = await account(o.id);
  assert.deepEqual([acc.stripe_customer_id, acc.plan], [customer.id, 'team']);
});

test('a customer deleted in Stripe is replaced at the next Checkout instead of failing every time', { skip }, async () => {
  const o = await org();
  const first = (await change(o, 'team', 'month')) as { url: string };
  assert.ok(first.url);
  const old = (await account(o.id)).stripe_customer_id;
  await control(`customers/${old}`, { deleted: true });
  // A later click (a new idempotency window) for another price, so the old key is not replayed.
  const again = await change(o, 'agency', 'month');
  assert.equal(again.kind, 'checkout', JSON.stringify(again));
  assert.notEqual((await account(o.id)).stripe_customer_id, old);
  await pay((again as { url: string }).url);
  assert.equal((await account(o.id)).plan, 'agency');
});
