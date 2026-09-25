/**
 * P2 fixes of docs/audyt-2026-09-25.md in the database and the Stripe webhook: invitations and member addresses,
 * workspace_org for outsiders, one acceptance per double submit, the drift view gated by plan, no grace period for a
 * subscription never paid, and one handling per Stripe event.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generateToken } from '../../lib/tokens.ts';
import { signStripePayload } from '../../lib/stripe.ts';
import { admin, appMissing, appUrl, setPlan, supabaseMissing, user, mustRun } from './helpers.ts';

const skip = mustRun(await supabaseMissing());
const skipApi = mustRun(skip ?? (await appMissing()));

async function org(name: string) {
  const owner = await user(`p2-${name}`);
  const orgId = (await owner.db.rpc('create_organization', { p_name: `P2 ${name}` })).data as string;
  return { owner, orgId };
}

test('an existing member cannot be invited again, and a changed address reaches the member row and the emails', { skip }, async () => {
  const { owner, orgId } = await org('members');
  await setPlan(orgId, 'team');
  const member = await user('p2-member');
  assert.ifError((await owner.db.from('invitations').insert({ organization_id: orgId, email: member.email, invited_by: owner.id })).error);
  await member.db.rpc('claim_invitations');
  const again = await owner.db.from('invitations').insert({ organization_id: orgId, email: member.email.toUpperCase(), invited_by: owner.id });
  assert.equal(again.error?.hint, 'member');

  const moved = `p2-moved-${randomUUID().slice(0, 8)}@it.flowretest.test`;
  assert.ifError((await admin().auth.admin.updateUserById(member.id, { email: moved, email_confirm: true })).error);
  // Emails go to the account's current address at once; the member row catches up at the next sign-in.
  const ws = (await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Acme' }).select('id').single()).data!.id;
  assert.ifError((await member.db.from('notification_subscriptions').insert({ workspace_id: ws, user_id: member.id, statuses: ['PASS'] })).error);
  const t = generateToken();
  assert.ifError((await owner.db.from('workspace_tokens').insert({ workspace_id: ws, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id })).error);
  const run = await admin().rpc('ingest_run', { p_token_hash: t.hash, p_n8n_workflow_id: 'wf', p_workflow_name: 'wf', p_status: 'PASS', p_mode: 'change', p_runner: '0', p_engine_image: 'i', p_old_label: 'o', p_new_label: 'n', p_sealed: true, p_local_run: '', p_summary: {}, p_report: { cases: [] }, p_report_bytes: 1, p_generated_at: new Date().toISOString() });
  assert.ifError(run.error);
  const recipients = await admin().rpc('run_recipients', { p_run_id: run.data![0]!.run_id });
  assert.deepEqual(recipients.data?.map((r) => r.email), [moved]);
  await member.db.rpc('claim_invitations');
  assert.equal((await admin().from('members').select('email').eq('organization_id', orgId).eq('user_id', member.id).single()).data?.email, moved);
});

test('workspace_org answers members only; policies behave as before', { skip }, async () => {
  const { owner, orgId } = await org('lookup');
  const outsider = await user('p2-outsider');
  const ws = (await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Acme' }).select('id').single()).data!.id;
  assert.equal((await owner.db.rpc('workspace_org', { ws })).data, orgId);
  assert.equal((await outsider.db.rpc('workspace_org', { ws })).data, null);
  assert.equal((await admin().rpc('workspace_org', { ws })).data, orgId, 'the service role still resolves it');
});

test('a double submit of one acceptance records it once', { skip }, async () => {
  const { owner, orgId } = await org('accept');
  const ws = (await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Acme' }).select('id').single()).data!.id;
  const t = generateToken();
  assert.ifError((await owner.db.from('workspace_tokens').insert({ workspace_id: ws, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id })).error);
  const report = { cases: [{ caseId: '1', status: 'PASS', entries: [] }], stability: { '1': true } };
  const run = await admin().rpc('ingest_run', { p_token_hash: t.hash, p_n8n_workflow_id: 'wf', p_workflow_name: 'wf', p_status: 'PASS', p_mode: 'change', p_runner: '0', p_engine_image: 'i', p_old_label: 'o', p_new_label: 'n', p_sealed: true, p_local_run: 'r1', p_summary: {}, p_report: report, p_report_bytes: 1, p_generated_at: new Date().toISOString() });
  const runId = run.data![0]!.run_id;
  const [a, b] = await Promise.all([
    owner.db.rpc('accept_run', { p_run_id: runId, p_case_ids: ['1'], p_message: 'ok' }),
    owner.db.rpc('accept_run', { p_run_id: runId, p_case_ids: ['1'], p_message: 'ok' }),
  ]);
  assert.ifError(a.error);
  assert.equal(a.data, b.data);
  assert.equal((await owner.db.from('acceptances').select('id').eq('run_id', runId)).data?.length, 1);
});

test('the drift view shows cells only on a plan with the drift matrix', { skip }, async () => {
  const { owner, orgId } = await org('drift');
  const ws = (await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Acme' }).select('id').single()).data!.id;
  const t = generateToken();
  assert.ifError((await owner.db.from('workspace_tokens').insert({ workspace_id: ws, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id })).error);
  const ingested = await admin().rpc('ingest_run', { p_token_hash: t.hash, p_n8n_workflow_id: 'wf', p_workflow_name: 'wf', p_status: 'PASS', p_mode: 'upgrade', p_runner: '0', p_engine_image: 'i', p_old_label: 'o', p_new_label: 'n', p_sealed: true, p_local_run: '', p_summary: {}, p_report: { cases: [], upgrade: { engineOld: 'n8nio/n8n:2.40.5', engineNew: 'n8nio/n8n:2.41.0' } }, p_report_bytes: 1, p_generated_at: new Date().toISOString() });
  assert.ifError(ingested.error);
  const cells = async () => (await owner.db.from('latest_upgrade_runs').select('id').eq('workspace_id', ws)).data?.length;
  assert.equal(await cells(), 0, 'Free sees no cells');
  await setPlan(orgId, 'agency');
  assert.equal(await cells(), 1);
});

test('a subscription whose first payment never went through gets no grace period', { skip }, async () => {
  const { orgId } = await org('incomplete');
  await setPlan(orgId, 'agency', 'incomplete');
  assert.ifError((await admin().from('billing_accounts').update({ ended_at: new Date().toISOString() }).eq('organization_id', orgId)).error);
  const plan = (await admin().rpc('org_plan', { org: orgId })).data?.[0];
  assert.deepEqual([plan?.plan, plan?.retention_days], ['free', 14]);
});

test('two deliveries of one Stripe event arriving together are handled once', { skip: skipApi ?? (process.env.STRIPE_WEBHOOK_SECRET ? undefined : 'no Stripe webhook secret') }, async () => {
  const body = JSON.stringify({ id: `evt_p2_${randomUUID()}`, type: 'customer.created', data: { object: { id: 'cus_x' } } });
  const deliver = () => fetch(`${appUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': signStripePayload(process.env.STRIPE_WEBHOOK_SECRET as string, body), 'content-type': 'application/json' }, body }).then((r) => r.json() as Promise<{ duplicate?: boolean }>);
  const answers = await Promise.all([deliver(), deliver(), deliver()]);
  assert.equal(answers.filter((a) => !a.duplicate).length, 1, JSON.stringify(answers));
});
