/**
 * Deleting data from the Data, workspace, run and Account pages (week 14, audit of week 14 items 16, 27 and 34): the
 * account deletion the service role runs, and the owner-only deletes of runs, workspaces and organizations that go
 * through RLS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteAccountData } from '../../lib/account.ts';
import { createCustomer, stripeConfig } from '../../lib/stripe.ts';
import { admin, setPlan, supabaseMissing, user, mustRun } from './helpers.ts';

const skip = mustRun(await supabaseMissing());
const tag = () => randomUUID().slice(0, 6);

async function orgOf(owner: Awaited<ReturnType<typeof user>>, name: string): Promise<string> {
  const created = await owner.db.rpc('create_organization', { p_name: `${name} ${tag()}` });
  assert.ifError(created.error);
  return created.data as string;
}

const exists = async (table: 'organizations' | 'workspaces' | 'runs', id: string) => ((await admin().from(table).select('id').eq('id', id)).data?.length ?? 0) === 1;
const accountExists = async (id: string) => !(await admin().auth.admin.getUserById(id)).error;

test('account deletion: refused without changes while an organization would lose its only owner or still charges', { skip }, async () => {
  const solo = await user('del-solo');
  const shared = await orgOf(solo, 'Shared');
  const colleague = await user('del-colleague');
  assert.ifError((await admin().from('members').insert({ organization_id: shared, user_id: colleague.id, email: colleague.email, role: 'member' })).error);
  const alone = await orgOf(solo, 'Alone');

  const refused = await deleteAccountData(admin(), undefined, solo.id);
  assert.match(refused.error ?? '', /Make another member of Shared .* an owner first/);
  assert.ok(await exists('organizations', alone), 'nothing was deleted before the refusal');
  assert.ok(await accountExists(solo.id));

  const paying = await user('del-paying');
  const billed = await orgOf(paying, 'Billed');
  await setPlan(billed, 'team');
  assert.match((await deleteAccountData(admin(), undefined, paying.id)).error ?? '', /Cancel the subscription of Billed/);
  assert.ok(await accountExists(paying.id));
  // Once the cancellation is scheduled the account and the organization go.
  assert.ifError((await admin().from('billing_accounts').update({ cancel_at_period_end: true }).eq('organization_id', billed)).error);
  assert.deepEqual(await deleteAccountData(admin(), undefined, paying.id), {});
  assert.equal(await exists('organizations', billed), false);
  assert.equal(await accountExists(paying.id), false);
});

test('account deletion: own organizations go, shared ones stay with the next owner on the Stripe customer', { skip }, async () => {
  const leaving = await user('del-leaving');
  const staying = await user('del-staying');
  const mine = await orgOf(leaving, 'Mine');
  const team = await orgOf(leaving, 'Team');
  assert.ifError((await admin().from('members').insert({ organization_id: team, user_id: staying.id, email: staying.email, role: 'owner' })).error);

  const config = stripeConfig();
  let customer: string | undefined;
  if (config) {
    customer = (await createCustomer(config, { organizationId: team, name: 'Team', email: leaving.email, attempt: tag() })).id;
    assert.ifError((await admin().from('billing_accounts').insert({ organization_id: team, stripe_customer_id: customer })).error);
  }

  assert.deepEqual(await deleteAccountData(admin(), config, leaving.id), {});
  assert.equal(await accountExists(leaving.id), false);
  assert.equal(await exists('organizations', mine), false, 'the organization only they belonged to');
  assert.ok(await exists('organizations', team), 'the shared organization stays');
  assert.deepEqual((await admin().from('members').select('user_id').eq('organization_id', team)).data!.map((m) => m.user_id), [staying.id]);
  if (config && customer) {
    const fake = (await (await fetch(`${config.apiUrl.replace(/\/stripe$/, '')}/__stripe`)).json()) as { customers: Array<{ id: string; email: string }> };
    assert.equal(fake.customers.find((c) => c.id === customer)?.email, staying.email, 'invoices go to the next owner');
  }
});

test('owners delete runs, workspaces and organizations; members cannot; a deleted run leaves its acceptances', { skip }, async () => {
  const owner = await user('del-owner');
  const member = await user('del-member');
  const org = await orgOf(owner, 'Deletes');
  assert.ifError((await admin().from('members').insert({ organization_id: org, user_id: member.id, email: member.email, role: 'member' })).error);
  const ws = (await owner.db.from('workspaces').insert({ organization_id: org, name: 'Client' }).select('id').single()).data!.id;
  const wf = (await admin().from('workflows').insert({ workspace_id: ws, n8n_workflow_id: 'wf-del', name: 'Flow' }).select('id').single()).data!.id;
  const report = { schemaVersion: 1, redacted: true, generatedAt: new Date().toISOString(), runner: '0.3.0', workflowName: 'Flow', workflowId: 'wf-del', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'a', newLabel: 'b', cases: [], coverage: { writeNodesTotal: 0, writeNodesCaptured: 0, replayedNodes: 0, unsupported: [] }, sealed: true };
  const run = (await admin().from('runs').insert({ workspace_id: ws, workflow_id: wf, status: 'PASS', mode: 'change', runner: '0.3.0', engine_image: 'n8nio/n8n:2.40.5', old_label: 'a', new_label: 'b', sealed: true, summary: {}, report, report_bytes: 10, generated_at: new Date().toISOString() } as never).select('id').single()).data!.id;
  const acceptance = (await admin().from('acceptances').insert({ workspace_id: ws, workflow_id: wf, run_id: run, case_ids: ['1'], accepted_by_email: owner.email }).select('id').single()).data!.id;

  assert.equal((await member.db.from('runs').delete().eq('id', run).select('id')).data?.length ?? 0, 0, 'RLS: members delete no run');
  assert.equal((await owner.db.from('runs').delete().eq('id', run).select('id')).data?.length, 1);
  assert.equal((await admin().from('acceptances').select('run_id').eq('id', acceptance).single()).data!.run_id, null, 'the acceptance stays without the link');

  assert.equal((await member.db.from('workspaces').delete().eq('id', ws).select('id')).data?.length ?? 0, 0);
  assert.equal((await owner.db.from('workspaces').delete().eq('id', ws).select('id')).data?.length, 1);
  assert.equal((await admin().from('acceptances').select('id').eq('id', acceptance)).data?.length, 0, 'acceptances go with the workspace');

  assert.equal((await member.db.from('organizations').delete().eq('id', org).select('id')).data?.length ?? 0, 0);
  assert.equal((await owner.db.from('organizations').delete().eq('id', org).select('id')).data?.length, 1);
  assert.equal((await admin().from('members').select('user_id').eq('organization_id', org)).data?.length, 0);
});

test('make owner: only owners promote, and the new owner can then act as one', { skip }, async () => {
  const owner = await user('promote-owner');
  const member = await user('promote-member');
  const org = await orgOf(owner, 'Promote');
  assert.ifError((await admin().from('members').insert({ organization_id: org, user_id: member.id, email: member.email, role: 'member' })).error);
  assert.equal((await member.db.from('members').update({ role: 'owner' }).eq('organization_id', org).eq('user_id', member.id).select('user_id')).data?.length ?? 0, 0, 'members do not promote themselves');
  assert.ifError((await owner.db.from('members').update({ role: 'owner' }).eq('organization_id', org).eq('user_id', member.id)).error);
  assert.equal((await member.db.rpc('is_owner', { org })).data, true);
  assert.ifError((await admin().from('organizations').delete().eq('id', org)).error);
});
