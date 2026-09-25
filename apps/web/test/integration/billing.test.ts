/**
 * Week 12: plan limits enforced by the database, retention, who reads billing data, and Stripe through the running app
 * and the fake Stripe of scripts/fake-services.mjs (Checkout, signed webhooks, the success page, cancellation).
 * The Stripe part needs `node scripts/fake-services.mjs init` before starting the app and `... serve` running.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { diffCase, redactPlanReport, type PlanReport } from '@flowretest/core';
import { generateToken } from '../../lib/tokens.ts';
import { signStripePayload } from '../../lib/stripe.ts';
import { admin, appMissing, appUrl, insertableRun, setPlan, supabaseMissing, user, type Db, mustRun } from './helpers.ts';

const skip = mustRun(await supabaseMissing());
const stripeUrl = process.env.STRIPE_API_URL ?? '';
async function stripeMissing(): Promise<string | undefined> {
  const missing = mustRun(skip ?? (await appMissing()));
  if (missing) return missing;
  if (!stripeUrl || !process.env.STRIPE_WEBHOOK_SECRET) return 'no fake Stripe in .env.local (node scripts/fake-services.mjs init)';
  const fakeBase = stripeUrl.replace(/\/stripe$/, '');
  try {
    await fetch(`${fakeBase}/__stripe`, { signal: AbortSignal.timeout(2000) });
  } catch {
    return `fake services not reachable at ${fakeBase} (node scripts/fake-services.mjs serve)`;
  }
  const res = await fetch(`${appUrl}/api/stripe/webhook`, { method: 'POST', body: '{}' });
  return res.status === 404 ? 'the app runs without Stripe settings; restart it after fake-services init' : undefined;
}
const skipStripe = mustRun(await stripeMissing());

type U = Awaited<ReturnType<typeof user>>;

async function organization(owner: U, name = 'Billing Agency'): Promise<string> {
  const org = await owner.db.rpc('create_organization', { p_name: `${name} ${randomUUID().slice(0, 6)}` });
  assert.ifError(org.error);
  return org.data as string;
}

async function workspace(db: Db, orgId: string, name: string) {
  return db.from('workspaces').insert({ organization_id: orgId, name }).select('id').single();
}

async function token(owner: U, workspaceId: string): Promise<{ token: string; hash: string }> {
  const t = generateToken();
  const created = await owner.db.from('workspace_tokens').insert({ workspace_id: workspaceId, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id });
  assert.ifError(created.error);
  return { token: t.token, hash: t.hash };
}

function ingestArgs(tokenHash: string) {
  return {
    p_token_hash: tokenHash, p_n8n_workflow_id: 'wf-billing', p_workflow_name: 'Billing flow', p_status: 'PASS', p_mode: 'change', p_runner: '0.3.0', p_engine_image: 'n8nio/n8n:2.40.5',
    p_old_label: 'recorded', p_new_label: 'draft.json', p_sealed: true, p_local_run: '', p_summary: { cases: 0 }, p_report: { cases: [] }, p_report_bytes: 10, p_generated_at: new Date().toISOString(),
  };
}

async function limits(db: Db, orgId: string) {
  const res = await db.rpc('org_plan', { org: orgId });
  assert.ifError(res.error);
  return res.data?.[0];
}

test('Free: one workspace and two seats, refused by the database with 53400', { skip }, async () => {
  const owner = await user('free-owner');
  const orgId = await organization(owner);
  assert.equal((await limits(owner.db, orgId))?.plan, 'free');
  assert.ifError((await workspace(owner.db, orgId, 'First')).error);
  const second = await workspace(owner.db, orgId, 'Second');
  assert.equal(second.error?.code, '53400');
  assert.equal(second.error?.hint, 'workspaces');
  assert.match(second.error?.message ?? '', /Free plan includes 1 workspace$/);

  const invite = (email: string) => owner.db.from('invitations').insert({ organization_id: orgId, email, invited_by: owner.id });
  assert.ifError((await invite(`one-${randomUUID().slice(0, 6)}@it.flowretest.test`)).error);
  const third = await invite(`two-${randomUUID().slice(0, 6)}@it.flowretest.test`);
  assert.equal(third.error?.code, '53400');
  assert.equal(third.error?.hint, 'seats');

  await setPlan(orgId, 'team');
  assert.ifError((await workspace(owner.db, orgId, 'Second')).error);
  assert.ifError((await invite(`three-${randomUUID().slice(0, 6)}@it.flowretest.test`)).error);
  const usage = await limits(owner.db, orgId);
  assert.deepEqual([usage?.plan, usage?.workspaces_used, usage?.seats_used, usage?.retention_days], ['team', 2, 3, 90]);
});

test('uploads per 24 hours and workspaces beyond the limit after a downgrade are refused in ingest_run', { skip }, async () => {
  const owner = await user('upload-owner');
  const orgId = await organization(owner);
  await setPlan(orgId, 'team');
  const older = (await workspace(owner.db, orgId, 'Older')).data!.id;
  const newer = (await workspace(owner.db, orgId, 'Newer')).data!.id;
  const olderToken = await token(owner, older);
  const newerToken = await token(owner, newer);
  assert.ifError((await admin().rpc('ingest_run', ingestArgs(newerToken.hash))).error);

  // The subscription ends: Free keeps one workspace, the oldest.
  await setPlan(orgId, 'team', 'canceled');
  assert.equal((await owner.db.rpc('workspace_over_limit', { ws: newer })).data, true);
  const refused = await admin().rpc('ingest_run', ingestArgs(newerToken.hash));
  assert.equal(refused.error?.code, '53400');
  assert.equal(refused.error?.hint, 'workspace-over-limit');
  assert.ifError((await admin().rpc('ingest_run', ingestArgs(olderToken.hash))).error);

  // Fill the Free plan's 50 uploads of the last 24 hours (uploads are counted in upload_events, not in runs).
  const orgOf = (await admin().from('workspaces').select('organization_id').eq('id', older).single()).data!.organization_id;
  assert.ifError((await admin().from('upload_events').insert(Array.from({ length: 48 }, () => ({ organization_id: orgOf })))).error);
  const full = await admin().rpc('ingest_run', ingestArgs(olderToken.hash));
  assert.equal(full.error?.code, '53400');
  assert.equal(full.error?.hint, 'uploads');
  // Deleting the day's runs does not give the uploads back.
  assert.ifError((await admin().from('runs').delete().eq('workspace_id', older)).error);
  assert.equal((await admin().rpc('ingest_run', ingestArgs(olderToken.hash))).error?.hint, 'uploads');
});

test('retention: runs past the plan period are purged, with 30 days of grace after a paid plan ends', { skip }, async () => {
  const owner = await user('retention-owner');
  const freeOrg = await organization(owner, 'Free');
  const graceOrg = await organization(owner, 'Grace');
  const runsOf = async (orgId: string, ages: number[]) => {
    const ws = (await workspace(owner.db, orgId, 'Customer')).data!.id;
    const t = await token(owner, ws);
    assert.ifError((await admin().rpc('ingest_run', ingestArgs(t.hash))).error);
    const first = (await admin().from('runs').select('*').eq('workspace_id', ws).single()).data!;
    const row = insertableRun(first);
    await admin().from('runs').delete().eq('id', first.id);
    const inserted = await admin().from('runs').insert(ages.map((days) => ({ ...row, created_at: new Date(Date.now() - days * 86_400_000).toISOString() }))).select('id, created_at');
    assert.ifError(inserted.error);
    return ws;
  };
  const freeWs = await runsOf(freeOrg, [5, 20]);
  const graceWs = await runsOf(graceOrg, [20, 100]);
  await setPlan(graceOrg, 'team', 'canceled');
  await admin().from('billing_accounts').update({ ended_at: new Date(Date.now() - 10 * 86_400_000).toISOString() }).eq('organization_id', graceOrg);
  assert.equal((await limits(owner.db, graceOrg))?.retention_days, 90, 'Team retention during the grace period');

  const purged = await admin().rpc('purge_expired_runs');
  assert.ifError(purged.error);
  const ages = async (ws: string) => (await admin().from('runs').select('created_at').eq('workspace_id', ws)).data!.map((r) => Math.round((Date.now() - Date.parse(r.created_at)) / 86_400_000));
  assert.deepEqual(await ages(freeWs), [5], 'Free keeps 14 days');
  assert.deepEqual(await ages(graceWs), [20], 'grace keeps Team 90 days, not more');
  assert.equal((await owner.db.rpc('purge_expired_runs')).error?.code, '42501', 'people cannot purge');
});

test('members see the plan but not Stripe ids; invoices are for owners; outsiders see nothing', { skip }, async () => {
  const owner = await user('bill-owner');
  const member = await user('bill-member');
  const outsider = await user('bill-outsider');
  const orgId = await organization(owner);
  await owner.db.from('invitations').insert({ organization_id: orgId, email: member.email, invited_by: owner.id });
  assert.equal((await member.db.rpc('claim_invitations')).data, 1);
  await setPlan(orgId, 'agency');
  await admin().from('invoices').insert({ id: `in_${randomUUID()}`, organization_id: orgId, status: 'paid', currency: 'eur', total: 19900, amount_paid: 19900, amount_due: 0, created_at: new Date().toISOString() });

  assert.equal((await member.db.from('billing_accounts').select('plan, status').eq('organization_id', orgId).single()).data?.plan, 'agency');
  assert.ok((await member.db.from('billing_accounts').select('stripe_customer_id')).error, 'a member read the Stripe customer id');
  assert.equal((await member.db.from('invoices').select('id').eq('organization_id', orgId)).data?.length, 0);
  assert.equal((await owner.db.from('invoices').select('id').eq('organization_id', orgId)).data?.length, 1);
  assert.equal((await outsider.db.from('billing_accounts').select('plan').eq('organization_id', orgId)).data?.length, 0);
  assert.equal((await outsider.db.rpc('org_plan', { org: orgId })).data?.length, 0);
  assert.equal((await outsider.db.from('plans').select('id')).data?.length, 3, 'plans are public');
  const write = await owner.db.from('billing_accounts').update({ plan: 'agency' } as never).eq('organization_id', orgId).select('plan');
  assert.ok(write.error || write.data?.length === 0, 'an owner wrote the plan');

  const deleted = await owner.db.from('organizations').delete().eq('id', orgId);
  assert.equal(deleted.error?.hint, 'subscription', 'an organization that is still charged was deleted');
});

// ---------------------------------------------------------------------------------------------------------------
// Stripe through the app
// ---------------------------------------------------------------------------------------------------------------

const stripe = (path: string, params: Record<string, string>) =>
  fetch(`${stripeUrl}${path}`, { method: 'POST', headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) }).then((r) => r.json() as Promise<Record<string, string>>);

/** What the choosePlan action does before redirecting: customer row, Checkout session on the Team monthly price. */
async function checkout(orgId: string): Promise<{ id: string; url: string }> {
  const customer = await stripe('/v1/customers', { name: 'Agency', email: 'owner@agency.test', 'metadata[organization_id]': orgId });
  assert.ifError((await admin().from('billing_accounts').insert({ organization_id: orgId, stripe_customer_id: customer.id as string })).error);
  const billing = `${appUrl}/o/${orgId}/billing`;
  const session = await stripe('/v1/checkout/sessions', {
    mode: 'subscription', customer: customer.id as string, 'line_items[0][price]': 'price_team_monthly', 'line_items[0][quantity]': '1',
    success_url: `${billing}?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${billing}?checkout=cancelled`,
  });
  return { id: session.id as string, url: session.url as string };
}

async function account(orgId: string) {
  return (await admin().from('billing_accounts').select('*').eq('organization_id', orgId).single()).data!;
}

test('Checkout: signed webhooks put the organization on Team and store the invoice; cancellation returns it to Free', { skip: skipStripe }, async () => {
  const owner = await user('stripe-owner');
  const orgId = await organization(owner);
  const session = await checkout(orgId);
  const paid = await fetch(session.url, { redirect: 'manual' });
  assert.equal(paid.status, 302);
  const state = await (await fetch(`${stripeUrl.replace(/\/stripe$/, '')}/__stripe`)).json() as { deliveries: Array<{ type: string; status: number }> };
  assert.deepEqual(state.deliveries.slice(-3).map((d) => [d.type, d.status]), [['checkout.session.completed', 200], ['customer.subscription.created', 200], ['invoice.paid', 200]]);

  const acc = await account(orgId);
  assert.deepEqual([acc.plan, acc.status, acc.billing_interval, acc.ended_at], ['team', 'active', 'month', null]);
  assert.ok(acc.current_period_end && Date.parse(acc.current_period_end) > Date.now());
  const invoices = (await owner.db.from('invoices').select('total, status, invoice_pdf').eq('organization_id', orgId)).data!;
  assert.equal(invoices.length, 1);
  assert.deepEqual([invoices[0]!.total, invoices[0]!.status], [7900, 'paid']);
  assert.equal((await limits(owner.db, orgId))?.workspaces, 10);

  const control = (status: string) =>
    fetch(`${stripeUrl.replace(/\/stripe$/, '')}/__stripe/subscriptions/${acc.stripe_subscription_id}`, { method: 'POST', body: JSON.stringify({ status }) });
  await control('past_due');
  assert.equal((await limits(owner.db, orgId))?.plan, 'team', 'past_due keeps the plan while Stripe retries');
  await control('canceled');
  const ended = await account(orgId);
  assert.equal(ended.status, 'canceled');
  assert.ok(ended.ended_at);
  const after = await limits(owner.db, orgId);
  assert.deepEqual([after?.plan, after?.retention_days], ['free', 90], 'Free, with Team retention during the grace period');
});

test('the success page applies the subscription even when no webhook arrives', { skip: skipStripe }, async () => {
  const owner = await user('stripe-page');
  const orgId = await organization(owner);
  const session = await checkout(orgId);
  const paid = await fetch(`${session.url}?deliver=0`, { redirect: 'manual' });
  const location = paid.headers.get('location') ?? '';
  assert.ok(location.includes(`session_id=${session.id}`), location);
  assert.equal((await account(orgId)).plan, null, 'nothing applied before the page');
  const page = await fetch(location, { headers: { cookie: owner.cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /The plan applies to this organization now/);
  assert.equal((await account(orgId)).plan, 'team');

  // Another organization's session does not apply here.
  const other = await organization(owner, 'Other');
  await admin().from('billing_accounts').insert({ organization_id: other, stripe_customer_id: `cus_other_${other}` });
  await fetch(`${appUrl}/o/${other}/billing?checkout=success&session_id=${session.id}`, { headers: { cookie: owner.cookie } });
  assert.equal((await account(other)).plan, null);
});

test('the webhook refuses bad signatures and applies a delivery once', { skip: skipStripe }, async () => {
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'customer.created', data: { object: { id: 'cus_x' } } });
  const post = (signature: string) => fetch(`${appUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': signature }, body });
  assert.equal((await post(signStripePayload('whsec_wrong', body))).status, 400);
  assert.equal((await post(`t=${Math.floor(Date.now() / 1000) - 3600},v1=${'a'.repeat(64)}`)).status, 400);
  const first = await post(signStripePayload(process.env.STRIPE_WEBHOOK_SECRET as string, body));
  assert.deepEqual(await first.json(), { received: true });
  const second = await post(signStripePayload(process.env.STRIPE_WEBHOOK_SECRET as string, body));
  assert.deepEqual(await second.json(), { received: true, duplicate: true });
});

test('Free sends no Slack message and posts no GitHub check, and logs why', { skip: skipStripe }, async () => {
  const owner = await user('free-integrations');
  const orgId = await organization(owner);
  const ws = (await workspace(owner.db, orgId, 'Customer')).data!.id;
  assert.ifError((await admin().from('slack_webhooks').insert({ workspace_id: ws, url: `${stripeUrl.replace(/\/stripe$/, '')}/slack/services/T/B/x`, url_hint: 'hooks…/x', statuses: ['PASS', 'DIFF'] })).error);
  const report: PlanReport = { runner: '0.3.0', workflowName: 'Free', workflowId: 'free-wf', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [diffCase('1', [], [])], coverage: { writeNodesTotal: 0, writeNodesCaptured: 0, replayedNodes: 0, unsupported: [] }, sealed: true };
  const body = JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redactPlanReport(report), git: { repository: 'acme-agency/flows', sha: 'd'.repeat(40) } });
  const res = await fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${(await token(owner, ws)).token}`, 'content-type': 'application/json' }, body });
  assert.equal(res.status, 201, await res.clone().text());
  const runId = ((await res.json()) as { id: string }).id;
  let slack: Array<{ ok: boolean; detail: string | null }> = [];
  let checks: Array<{ ok: boolean; detail: string | null }> = [];
  for (let i = 0; i < 40 && (slack.length === 0 || checks.length === 0); i++) {
    await new Promise((r) => setTimeout(r, 250));
    slack = (await admin().from('notification_log').select('ok, detail').eq('run_id', runId).eq('channel', 'slack')).data ?? [];
    checks = (await admin().from('github_checks').select('ok, detail').eq('run_id', runId)).data ?? [];
  }
  assert.deepEqual(slack.map((s) => [s.ok, s.detail]), [[false, 'not sent: the free plan has no GitHub checks or Slack messages']]);
  assert.deepEqual(checks.map((c) => [c.ok, c.detail]), [[false, 'not posted: the free plan has no GitHub checks or Slack messages']]);
});

test('the upload API answers 402 for a workspace beyond the plan and 429 when uploads run out', { skip: skipStripe }, async () => {
  const owner = await user('limit-api');
  const orgId = await organization(owner);
  await setPlan(orgId, 'team');
  const older = (await workspace(owner.db, orgId, 'Older')).data!.id;
  const newer = (await workspace(owner.db, orgId, 'Newer')).data!.id;
  await setPlan(orgId, 'team', 'canceled');
  const report: PlanReport = { runner: '0.3.0', workflowName: 'Limits', workflowId: 'limits-wf', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [diffCase('1', [], [])], coverage: { writeNodesTotal: 0, writeNodesCaptured: 0, replayedNodes: 0, unsupported: [] }, sealed: true };
  const body = JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redactPlanReport(report) });
  const upload = async (ws: string) => fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${(await token(owner, ws)).token}`, 'content-type': 'application/json' }, body });

  const over = await upload(newer);
  assert.equal(over.status, 402);
  assert.match(((await over.json()) as { error: string }).error, /past the limit of the Free plan \(1 workspace, oldest first\).*Billing page/);
  const ok = await upload(older);
  assert.equal(ok.status, 201, await ok.clone().text());
  const orgOf = (await admin().from('workspaces').select('organization_id').eq('id', older).single()).data!.organization_id;
  await admin().from('upload_events').insert(Array.from({ length: 49 }, () => ({ organization_id: orgOf })));
  const full = await upload(older);
  assert.equal(full.status, 429);
  assert.equal(full.headers.get('retry-after'), '3600');
});
