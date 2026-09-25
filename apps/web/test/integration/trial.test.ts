/**
 * Free trial of the first paid plan (ADR 0017), end to end against the fake Stripe and the running app: Checkout with
 * a trial, the plan while trialing, a switch during the trial, the first charge when it ends, one trial per organization.
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
const config: StripeConfig = { ...(stripeConfig() as StripeConfig), trialDays: 14 };
const DAY = 86_400_000;

type Owner = Awaited<ReturnType<typeof user>>;

async function org(): Promise<{ id: string; email: string; owner: Owner }> {
  const owner = await user('trial-owner');
  const created = await owner.db.rpc('create_organization', { p_name: `Trial ${randomUUID().slice(0, 6)}` });
  assert.ifError(created.error);
  return { id: created.data as string, email: owner.email, owner };
}

const change = (o: { id: string; email: string }, plan: 'team' | 'agency', interval: 'month' | 'year', cfg = config) =>
  changePlan(admin(), cfg, { orgId: o.id, plan, interval, email: o.email, billingUrl: `${appUrl}/o/${o.id}/billing` });

const account = async (orgId: string) => (await admin().from('billing_accounts').select('*').eq('organization_id', orgId).single()).data!;
const control = (path: string, body: unknown) => fetch(`${fakeBase}/__stripe/${path}`, { method: 'POST', body: JSON.stringify(body) });
const fake = async () => (await (await fetch(`${fakeBase}/__stripe`)).json()) as { sessions: Array<Record<string, unknown>> };
const sessionOf = async (url: string) => (await fake()).sessions.find((s) => s.url === url)!;

async function pay(url: string): Promise<void> {
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 302);
}

async function invoices(orgId: string) {
  return (await admin().from('invoices').select('total, status').eq('organization_id', orgId).order('created_at')).data!;
}

test('the first Checkout starts a trial: the plan applies at once, nothing is charged, the page says until when', { skip }, async () => {
  const o = await org();
  const first = await change(o, 'team', 'month');
  assert.equal(first.kind, 'checkout');
  const url = (first as { url: string }).url;
  const session = await sessionOf(url);
  assert.deepEqual([session.trial_period_days, session.trial_missing_payment_method, session.payment_method_collection], [14, 'cancel', 'always'], 'a trial that still takes a card');

  await pay(url);
  const acc = await account(o.id);
  assert.deepEqual([acc.plan, acc.status], ['team', 'trialing']);
  const days = (Date.parse(acc.trial_end!) - Date.now()) / DAY;
  assert.ok(days > 13.9 && days <= 14, `trial ends in ${days} days`);
  assert.ok(acc.first_subscription_at, 'the trial is used up');
  assert.deepEqual((await invoices(o.id)).map((i) => [i.total, i.status]), [[0, 'paid']]);
  const plan = (await o.owner.db.rpc('org_plan', { org: o.id })).data![0]!;
  assert.deepEqual([plan.plan, plan.workspaces, plan.integrations], ['team', 10, true], 'trialing gives the whole plan');

  // Text only: dates sit in <time> elements, and React separates text nodes with <!-- -->.
  const page = (await (await fetch(`${appUrl}/o/${o.id}/billing`, { headers: { cookie: o.owner.cookie } })).text()).replace(/<[^>]*>/g, '');
  assert.match(page, /Free trial until \d{4}-\d{2}-\d{2}/);
  assert.match(page, /the card is charged 79 EUR a month plus VAT where due unless you cancel/);
  assert.doesNotMatch(page, /Try Agency free/, 'no second trial is offered');
});

test('a switch during the trial costs nothing and keeps the end date; the trial end brings the first charge', { skip }, async () => {
  const o = await org();
  await pay(((await change(o, 'team', 'month')) as { url: string }).url);
  const trialEnd = (await account(o.id)).trial_end;

  const up = await change(o, 'agency', 'year');
  assert.equal(up.kind, 'switched', JSON.stringify(up));
  assert.match((up as { ok: string }).ok, /free trial continues until \d{4}-\d{2}-\d{2}/);
  const during = await account(o.id);
  assert.deepEqual([during.plan, during.billing_interval, during.status, during.trial_end], ['agency', 'year', 'trialing', trialEnd]);
  assert.deepEqual((await invoices(o.id)).map((i) => i.total), [0, 0]);

  await control(`subscriptions/${during.stripe_subscription_id}`, { end_trial: true });
  const after = await account(o.id);
  assert.deepEqual([after.plan, after.status, after.trial_end], ['agency', 'active', null]);
  // Invoices of one second share created_at, so look the first charge up instead of taking the last row.
  assert.ok((await invoices(o.id)).some((i) => i.total === 191040 && i.status === 'paid'), 'the first yearly Agency charge');
});

test('a card that fails when the trial ends leaves the plan past due, as any failed renewal', { skip }, async () => {
  const o = await org();
  await pay(((await change(o, 'team', 'month')) as { url: string }).url);
  const acc = await account(o.id);
  await control(`customers/${acc.stripe_customer_id}`, { fail_payments: true });
  await control(`subscriptions/${acc.stripe_subscription_id}`, { end_trial: true });
  const after = await account(o.id);
  assert.deepEqual([after.plan, after.status], ['team', 'past_due']);
  assert.ok((await invoices(o.id)).some((i) => i.total === 7900 && i.status === 'open'), 'the failed first charge stays open');
});

test('one trial per organization; none when trials are off', { skip }, async () => {
  const o = await org();
  await pay(((await change(o, 'team', 'month')) as { url: string }).url);
  const acc = await account(o.id);
  await control(`subscriptions/${acc.stripe_subscription_id}`, { status: 'canceled' });
  assert.equal((await account(o.id)).status, 'canceled');
  const again = await change(o, 'team', 'year');
  assert.equal(again.kind, 'checkout');
  assert.equal((await sessionOf((again as { url: string }).url)).trial_period_days, null, 'the second subscription starts paid');

  const fresh = await org();
  const off = await change(fresh, 'team', 'month', { ...config, trialDays: 0 });
  assert.equal((await sessionOf((off as { url: string }).url)).trial_period_days, null);
  // Nothing was paid, so the organization keeps its trial for later.
  assert.equal((await account(fresh.id)).first_subscription_at, null);
});

test('two Checkout tabs paid before either synced: the second trial is cancelled, one plan is billed', { skip }, async () => {
  // Audit of week 14, item 9: both sessions carried a trial, and both subscriptions would charge when the trials ended.
  const o = await org();
  const team = (await change(o, 'team', 'month')) as { url: string };
  const agency = (await change(o, 'agency', 'month')) as { url: string };
  assert.equal((await sessionOf(agency.url)).trial_period_days, 14, 'the second tab still got a trial');
  await pay(team.url);
  await pay(agency.url);
  const acc = await account(o.id);
  assert.deepEqual([acc.plan, acc.status], ['team', 'trialing'], 'the first paid tab is the plan');
  const subs = ((await fake()) as unknown as { subscriptions: Array<{ id: string; customer: string; status: string }> }).subscriptions.filter((s) => s.customer === acc.stripe_customer_id);
  assert.deepEqual(subs.map((s) => s.status).sort(), ['canceled', 'trialing']);
  assert.equal(subs.find((s) => s.status === 'trialing')!.id, acc.stripe_subscription_id);
});
