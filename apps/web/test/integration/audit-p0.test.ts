/**
 * The database side of the P0 fixes in docs/audyt-2026-09-25.md: revocation is final, only the server stores Slack
 * webhooks, a password never opens a session, plan changes keep retention and plans.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generateToken } from '../../lib/tokens.ts';
import { admin, anon, setPlan, supabaseMissing, user, type Db, mustRun } from './helpers.ts';

const skip = mustRun(await supabaseMissing());

let owner: { db: Db; id: string; email: string };
let member: { db: Db; id: string; email: string };
let orgId: string;
let workspaceId: string;

before(async () => {
  if (skip) return;
  owner = await user('p0-owner');
  member = await user('p0-member');
  const org = await owner.db.rpc('create_organization', { p_name: 'P0 Agency' });
  assert.ifError(org.error);
  orgId = org.data as string;
  const ws = await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Acme' }).select('id').single();
  assert.ifError(ws.error);
  workspaceId = ws.data!.id;
  assert.ifError((await owner.db.from('invitations').insert({ organization_id: orgId, email: member.email, invited_by: owner.id })).error);
  assert.equal((await member.db.rpc('claim_invitations')).data, 1);
});

test('a member may revoke a token, nobody may bring it back', { skip }, async () => {
  const t = generateToken();
  const created = await owner.db.from('workspace_tokens').insert({ workspace_id: workspaceId, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id }).select('id').single();
  assert.ifError(created.error);
  const id = created.data!.id;
  assert.ifError((await member.db.from('workspace_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id)).error);
  const back = await member.db.from('workspace_tokens').update({ revoked_at: null }).eq('id', id);
  assert.equal(back.error?.code, '42501');
  assert.equal((await owner.db.from('workspace_tokens').update({ revoked_at: null }).eq('id', id)).error?.code, '42501', 'owners neither');
  const row = await owner.db.from('workspace_tokens').select('revoked_at').eq('id', id).single();
  assert.ok(row.data?.revoked_at);
});

test('people cannot store Slack webhooks themselves, not even owners on a paid plan', { skip }, async () => {
  await setPlan(orgId, 'team');
  const inserted = await owner.db.from('slack_webhooks').insert({ workspace_id: workspaceId, url: 'http://169.254.169.254/latest/meta-data', url_hint: 'hooks.slack.com/…', statuses: ['DIFF'], created_by: owner.id });
  assert.ok(inserted.error, 'owner inserted a webhook past the app');
});

test('a password sign-up for an invitee address gives no session and claims no invitation', { skip }, async () => {
  const email = `p0-invitee-${randomUUID().slice(0, 8)}@it.flowretest.test`;
  assert.ifError((await owner.db.from('invitations').insert({ organization_id: orgId, email, invited_by: owner.id })).error);
  const squatter = anon();
  const password = randomUUID();
  // The public sign-up endpoint accepts the address; with autoconfirm it would hand out a session right away.
  const signedUp = await squatter.auth.signUp({ email, password });
  assert.equal(signedUp.data.session, null, 'password sign-up opened a session');
  const signedIn = await squatter.auth.signInWithPassword({ email, password });
  assert.ok(signedIn.error, 'password sign-in worked');
  assert.equal((await squatter.rpc('claim_invitations')).data ?? 0, 0);
  const pending = await owner.db.from('invitations').select('email').eq('organization_id', orgId).eq('email', email);
  assert.equal(pending.data?.length, 1, 'the invitation is still waiting for its owner');
  const id = signedUp.data.user?.id;
  if (id) await admin().auth.admin.deleteUser(id);
  await owner.db.from('invitations').delete().eq('organization_id', orgId).eq('email', email);
});

test('plan changes: a smaller paid plan keeps the old retention for 30 days; an unknown price keeps the plan', { skip }, async () => {
  const db = admin();
  const org = (await owner.db.rpc('create_organization', { p_name: 'P0 Downgrade' })).data as string;
  const plan = async () => (await db.rpc('org_plan', { org })).data?.[0];
  await setPlan(org, 'agency');
  assert.equal((await plan())?.retention_days, 365);

  assert.ifError((await db.from('billing_accounts').update({ plan: 'team' }).eq('organization_id', org)).error);
  assert.deepEqual([(await plan())?.plan, (await plan())?.retention_days], ['team', 365], 'Agency retention during the grace period');
  const account = await db.from('billing_accounts').select('previous_plan, plan_changed_at').eq('organization_id', org).single();
  assert.equal(account.data?.previous_plan, 'agency');

  const monthAgo = new Date(Date.now() - 31 * 86400_000).toISOString();
  assert.ifError((await db.from('billing_accounts').update({ plan_changed_at: monthAgo }).eq('organization_id', org)).error);
  assert.equal((await plan())?.retention_days, 90, 'Team retention after the grace period');

  // A live subscription on a price the app does not recognise must not fall back to Free (and lose history).
  assert.ifError((await db.from('billing_accounts').update({ plan: null, status: 'active' }).eq('organization_id', org)).error);
  assert.equal((await plan())?.plan, 'team');
});

test('the grace period counts from the moment the plan stopped, not from the latest sync', { skip }, async () => {
  const db = admin();
  const org = (await owner.db.rpc('create_organization', { p_name: 'P0 Unpaid' })).data as string;
  await setPlan(org, 'team');
  const stopped = new Date(Date.now() - 20 * 86400_000).toISOString();
  assert.ifError((await db.from('billing_accounts').update({ status: 'unpaid', ended_at: stopped }).eq('organization_id', org)).error);
  // A later sync of the still unpaid subscription writes "now" again.
  assert.ifError((await db.from('billing_accounts').update({ status: 'unpaid', ended_at: new Date().toISOString() }).eq('organization_id', org)).error);
  const row = await db.from('billing_accounts').select('ended_at').eq('organization_id', org).single();
  assert.equal(new Date(row.data!.ended_at!).toISOString(), stopped);
});
