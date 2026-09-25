import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TRIAL_DAYS, stripeConfig, subscriptionState, trialDays, type StripeSubscription } from '../../lib/stripe.ts';
import { trialFor } from '../../lib/plan-change.ts';

test('STRIPE_TRIAL_DAYS: 14 by default, 0 turns trials off, anything odd turns them off too', () => {
  assert.equal(DEFAULT_TRIAL_DAYS, 14);
  assert.equal(trialDays({}), 14);
  assert.equal(trialDays({ STRIPE_TRIAL_DAYS: '0' }), 0);
  assert.equal(trialDays({ STRIPE_TRIAL_DAYS: ' 30 ' }), 30);
  for (const odd of ['-1', '7.5', '91', 'two weeks', 'off']) assert.equal(trialDays({ STRIPE_TRIAL_DAYS: odd }), 0, odd);
  assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', STRIPE_TRIAL_DAYS: '7' })?.trialDays, 7);
});

test('a trial only for an organization that never had a subscription', () => {
  assert.equal(trialFor({ trialDays: 14 }, undefined), 14);
  assert.equal(trialFor({ trialDays: 14 }, { first_subscription_at: null }), 14);
  assert.equal(trialFor({ trialDays: 14 }, { first_subscription_at: '2026-09-01T00:00:00Z' }), 0);
  assert.equal(trialFor({ trialDays: 0 }, undefined), 0);
});

test('the trial end is kept while trialing and dropped once the subscription is paid', () => {
  const sub = (status: string): StripeSubscription => ({
    id: 'sub_1', customer: 'cus_1', status, cancel_at_period_end: false, ended_at: null, canceled_at: null, metadata: {}, trial_end: 1_790_000_000,
    items: { data: [{ id: 'si_1', current_period_end: 1_790_000_000, price: { id: 'price_team_monthly', lookup_key: 'flowretest_team_monthly', unit_amount: 7900, currency: 'eur', recurring: { interval: 'month' }, metadata: { flowretest_plan: 'team' } } as never }] },
  });
  const trialing = subscriptionState(sub('trialing'));
  assert.equal(trialing.trialEnd, new Date(1_790_000_000 * 1000).toISOString());
  assert.equal(trialing.plan, 'team');
  assert.equal(trialing.endedAt, null, 'trialing gives the plan');
  assert.equal(subscriptionState(sub('active')).trialEnd, null);
});
