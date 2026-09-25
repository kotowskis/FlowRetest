import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changeSubscriptionPrice, createCheckoutSession, createCustomer, createPortalSession, formEncode, getCheckoutSession, getInvoice, getSubscription, lookupKey, parseLookupKey, planOfPrice,
  priceFor, signStripePayload, stripeConfig, subscriptionState, verifyStripeSignature, type StripeConfig, type StripeSubscription,
} from '../../lib/stripe.ts';
import { planLimitOf } from '../../lib/limits.ts';
// @ts-expect-error plain JS dev script without types
import { FAKE, startFakeServices } from '../../scripts/fake-services.mjs';

let fake: { base: string; stripe: { deliveries: Array<{ type: string; status: number }> }; close: () => Promise<void> };
let config: StripeConfig;

before(async () => {
  // The app URL does not answer: webhook deliveries are recorded as failed and the flow goes on.
  fake = await startFakeServices({ port: 0, publicKeyPem: '', appUrl: 'http://127.0.0.1:9' });
  config = stripeConfig({ STRIPE_SECRET_KEY: FAKE.stripeKey, STRIPE_WEBHOOK_SECRET: FAKE.stripeWebhookSecret, STRIPE_API_URL: `${fake.base}/stripe/` }) as StripeConfig;
});
after(() => fake.close());

test('config needs the key and the webhook secret; automatic tax is opt-in', () => {
  assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_x' }), undefined);
  assert.equal(config.apiUrl, `${fake.base}/stripe`);
  assert.equal(config.automaticTax, false);
  assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'k', STRIPE_WEBHOOK_SECRET: 'w' })?.apiUrl, 'https://api.stripe.com');
});

test('form encoding uses Stripe bracket notation and drops empty values', () => {
  assert.equal(
    decodeURIComponent(formEncode({ mode: 'subscription', line_items: [{ price: 'p', quantity: '1' }], metadata: { organization_id: 'o' }, automatic_tax: undefined, flag: true })),
    'mode=subscription&line_items[0][price]=p&line_items[0][quantity]=1&metadata[organization_id]=o&flag=true',
  );
});

test('lookup keys map to plans and back; anything else is no plan', () => {
  assert.equal(lookupKey('team', 'month'), 'flowretest_team_monthly');
  assert.deepEqual(parseLookupKey('flowretest_agency_yearly'), { plan: 'agency', interval: 'year' });
  assert.equal(parseLookupKey('flowretest_enterprise_monthly'), undefined);
  assert.equal(parseLookupKey(null), undefined);
});

test('webhook signatures: right secret and fresh timestamp only', () => {
  const body = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  const header = signStripePayload('whsec_a', body, now);
  assert.equal(verifyStripeSignature('whsec_a', body, header, now), true);
  assert.equal(verifyStripeSignature('whsec_b', body, header, now), false);
  assert.equal(verifyStripeSignature('whsec_a', `${body} `, header, now), false);
  assert.equal(verifyStripeSignature('whsec_a', body, header, now + 301), false, 'replayed after the tolerance');
  assert.equal(verifyStripeSignature('whsec_a', body, null, now), false);
  // During a secret rotation Stripe sends one v1 per secret.
  const rotated = `${header},v1=${'0'.repeat(64)}`;
  assert.equal(verifyStripeSignature('whsec_a', body, rotated, now), true);
  assert.equal(verifyStripeSignature('whsec_a', body, `t=${now},v1=zz`, now), false);
});

test('subscription state: the plan comes from the price lookup key, the period from the item', () => {
  const sub = (status: string, lookup: string | null): StripeSubscription => ({
    id: 'sub_1', customer: 'cus_1', status, cancel_at_period_end: false, ended_at: status === 'canceled' ? 1_800_000_000 : null, canceled_at: null, metadata: { organization_id: 'x' },
    items: { data: [{ id: 'si_1', current_period_end: 1_800_000_000, price: { id: 'p', lookup_key: lookup, unit_amount: 7900, currency: 'eur', recurring: { interval: 'month' } } }] },
  });
  const active = subscriptionState(sub('active', 'flowretest_team_monthly'));
  assert.deepEqual(active, { plan: 'team', interval: 'month', status: 'active', currentPeriodEnd: new Date(1_800_000_000_000).toISOString(), cancelAtPeriodEnd: false, cancelAt: null, endedAt: null, trialEnd: null });
  // Flexible billing mode schedules the end with cancel_at; classic mode with cancel_at_period_end at the period end.
  assert.equal(subscriptionState({ ...sub('active', 'flowretest_team_monthly'), cancel_at: 1_800_000_000 }).cancelAt, new Date(1_800_000_000_000).toISOString());
  assert.equal(subscriptionState({ ...sub('active', 'flowretest_team_monthly'), cancel_at_period_end: true }).cancelAt, new Date(1_800_000_000_000).toISOString());
  assert.equal(subscriptionState(sub('past_due', 'flowretest_team_monthly')).endedAt, null, 'past_due keeps the plan');
  assert.equal(subscriptionState(sub('canceled', 'flowretest_team_monthly')).endedAt, new Date(1_800_000_000_000).toISOString());
  assert.equal(subscriptionState(sub('active', 'someone_elses_price')).plan, null);
});

test('a price that lost its lookup key to a newer price keeps its plan through the metadata', () => {
  const price = (lookup: string | null, metadata?: Record<string, string>, interval = 'year') => ({ id: 'p', lookup_key: lookup, unit_amount: 75840, currency: 'eur', recurring: { interval }, metadata });
  // transfer_lookup_key moved flowretest_team_yearly to a new price; this subscriber still pays the old one.
  assert.deepEqual(planOfPrice(price(null, { flowretest_plan: 'team' })), { plan: 'team', interval: 'year' });
  assert.deepEqual(planOfPrice(price('flowretest_agency_monthly')), { plan: 'agency', interval: 'month' }, 'older prices without metadata');
  assert.equal(planOfPrice(price(null, { flowretest_plan: 'enterprise' })), undefined);
  assert.equal(planOfPrice(price(null, { flowretest_plan: 'team' }, 'week')), undefined);
});

test('customer, checkout, payment, plan change and portal against the fake Stripe', async () => {
  const customer = await createCustomer(config, { organizationId: 'org-1', name: 'Acme', email: 'owner@acme.test' });
  const again = await createCustomer(config, { organizationId: 'org-1', name: 'Acme', email: 'owner@acme.test' });
  assert.equal(again.id, customer.id, 'the idempotency key stops a second customer');

  const price = await priceFor(config, 'team', 'month');
  assert.equal(price.unit_amount, 7900);
  await assert.rejects(priceFor({ ...config, secretKey: 'sk_wrong' }, 'team', 'month'), /401/);

  const session = await createCheckoutSession(config, { customer: customer.id, price: price.id, organizationId: 'org-1', successUrl: 'http://app.test/ok?s={CHECKOUT_SESSION_ID}', cancelUrl: 'http://app.test/no' });
  assert.ok(session.url);
  const paid = await fetch(session.url, { redirect: 'manual' });
  assert.equal(paid.headers.get('location'), `http://app.test/ok?s=${session.id}`);
  assert.deepEqual(fake.stripe.deliveries.map((d) => d.type), ['checkout.session.completed', 'customer.subscription.created', 'invoice.paid']);

  const completed = await getCheckoutSession(config, session.id);
  assert.ok(completed.subscription);
  const sub = await getSubscription(config, completed.subscription);
  assert.equal(subscriptionState(sub).plan, 'team');

  const yearly = await priceFor(config, 'agency', 'year');
  const changed = await changeSubscriptionPrice(config, sub, yearly.id);
  assert.deepEqual({ plan: subscriptionState(changed).plan, interval: subscriptionState(changed).interval }, { plan: 'agency', interval: 'year' });
  // The difference is billed now and the new price applies only once that invoice is paid.
  const update = (await (await fetch(`${fake.base}/__calls`)).json() as Array<{ method: string; path: string; body: string }>).filter((c) => c.method === 'POST' && c.path === `/stripe/v1/subscriptions/${sub.id}`).pop();
  const form = new URLSearchParams(update?.body ?? '');
  assert.equal(form.get('proration_behavior'), 'always_invoice');
  assert.equal(form.get('payment_behavior'), 'pending_if_incomplete');

  const invoiceId = (await (await fetch(`${fake.base}/__stripe`)).json() as { invoices: Array<{ id: string }> }).invoices.at(-1)?.id as string;
  const invoice = await getInvoice(config, invoiceId);
  assert.equal(invoice.total, 191040);
  assert.equal(invoice.status, 'paid');

  const portal = await createPortalSession(config, { customer: customer.id, returnUrl: 'http://app.test/billing' });
  assert.equal((await fetch(portal.url, { redirect: 'manual' })).headers.get('location'), 'http://app.test/billing');
});

test('plan limit errors are recognised by SQLSTATE and hint only', () => {
  assert.equal(planLimitOf({ code: '53400', hint: 'uploads' }), 'uploads');
  assert.equal(planLimitOf({ code: '53400', hint: 'seats' }), 'seats');
  assert.equal(planLimitOf({ code: '23505', hint: 'uploads' }), undefined);
  assert.equal(planLimitOf(null), undefined);
});
