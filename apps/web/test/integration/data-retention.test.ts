/**
 * Week 14: the retention policy as the database enforces it (shorter history chosen by an owner, expiring
 * invitations), DPA acceptances, and through the running app the export, the DPA copy and the public pages.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { diffCase, redactPlanReport, type PlanReport } from '@flowretest/core';
import { generateToken } from '../../lib/tokens.ts';
import { DPA_VERSION, LEGAL_SLUGS, PLAN_HISTORY_DAYS } from '../../lib/legal/documents.ts';
import { admin, anon, appMissing, appUrl, insertableRun, setPlan, supabaseMissing, user, mustRun } from './helpers.ts';

const skipDb = mustRun(await supabaseMissing());
const skipApp = skipDb ?? mustRun(await appMissing());

type U = Awaited<ReturnType<typeof user>>;
let owner: U;
let member: U;
let outsider: U;
let orgId: string;
let workspaceId: string;
let tokenHash: string;

const DAY = 86_400_000;

before(async () => {
  if (skipDb) return;
  owner = await user('data-owner');
  member = await user('data-member');
  outsider = await user('data-outsider');
  orgId = (await owner.db.rpc('create_organization', { p_name: `Data Agency ${randomUUID().slice(0, 6)}` })).data as string;
  assert.ifError((await admin().from('members').insert({ organization_id: orgId, user_id: member.id, email: member.email, role: 'member' })).error);
  workspaceId = (await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Customer' }).select('id').single()).data!.id;
  const t = generateToken();
  assert.ifError((await owner.db.from('workspace_tokens').insert({ workspace_id: workspaceId, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id })).error);
  tokenHash = t.hash;
});

function ingestArgs(hash: string) {
  const report: PlanReport = { runner: '0.3.0', workflowName: 'Flow', workflowId: 'wf-data', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [diffCase('1', [], [])], coverage: { writeNodesTotal: 0, writeNodesCaptured: 0, replayedNodes: 0, unsupported: [] }, sealed: true };
  const redacted = { schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redactPlanReport(report) };
  return {
    p_token_hash: hash, p_n8n_workflow_id: 'wf-data', p_workflow_name: 'Flow', p_status: 'PASS', p_mode: 'change', p_runner: '0.3.0', p_engine_image: 'n8nio/n8n:2.40.5',
    p_old_label: 'recorded', p_new_label: 'draft.json', p_sealed: true, p_local_run: '', p_summary: {}, p_report: redacted, p_report_bytes: 100, p_generated_at: new Date().toISOString(),
  };
}

/** Replaces the workspace's runs with runs of the given ages in days. */
async function runsAged(ages: number[]): Promise<void> {
  assert.ifError((await admin().rpc('ingest_run', ingestArgs(tokenHash) as never)).error);
  const first = (await admin().from('runs').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(1).single()).data!;
  const row = insertableRun(first);
  assert.ifError((await admin().from('runs').delete().eq('workspace_id', workspaceId)).error);
  assert.ifError((await admin().from('runs').insert(ages.map((d) => ({ ...row, created_at: new Date(Date.now() - d * DAY).toISOString() })))).error);
}

const agesNow = async () => (await admin().from('runs').select('created_at').eq('workspace_id', workspaceId).order('created_at')).data!.map((r) => Math.round((Date.now() - Date.parse(r.created_at)) / DAY)).sort((a, b) => a - b);

test('the plans table holds the history periods the retention page publishes', { skip: skipDb }, async () => {
  const { data } = await anon().from('plans').select('id, retention_days');
  const byId = Object.fromEntries((data ?? []).map((p) => [p.id, p.retention_days]));
  assert.deepEqual(byId, { free: PLAN_HISTORY_DAYS.Free, team: PLAN_HISTORY_DAYS.Team, agency: PLAN_HISTORY_DAYS.Agency });
});

test('an owner shortens the run history; the nightly purge takes the shorter period, members cannot change it', { skip: skipDb }, async () => {
  await setPlan(orgId, 'team');
  await runsAged([5, 40, 80, 120]);
  assert.equal((await member.db.from('organizations').update({ retention_days: 1 }).eq('id', orgId).select('id')).data?.length ?? 0, 0, 'RLS: members update nothing');
  assert.equal((await outsider.db.from('organizations').update({ retention_days: 1 }).eq('id', orgId).select('id')).data?.length ?? 0, 0);
  assert.ifError((await owner.db.from('organizations').update({ retention_days: 30 }).eq('id', orgId)).error);
  assert.ifError((await admin().rpc('purge_expired_runs')).error);
  assert.deepEqual(await agesNow(), [5], 'Team keeps 90 days, the owner asked for 30');

  // A longer period than the plan's changes nothing: the plan's 90 days win.
  await runsAged([5, 80, 120]);
  assert.ifError((await owner.db.from('organizations').update({ retention_days: 3650 }).eq('id', orgId)).error);
  assert.ifError((await admin().rpc('purge_expired_runs')).error);
  assert.deepEqual(await agesNow(), [5, 80]);
  assert.equal((await owner.db.from('organizations').update({ retention_days: 0 }).eq('id', orgId)).error?.code, '23514', 'at least one day');
  assert.ifError((await owner.db.from('organizations').update({ retention_days: null }).eq('id', orgId)).error);
});

test('invitations expire after 30 days: not claimable, purged at night', { skip: skipDb }, async () => {
  await setPlan(orgId, 'agency');
  const email = `late-${randomUUID().slice(0, 8)}@it.flowretest.test`;
  const fresh = `fresh-${randomUUID().slice(0, 8)}@it.flowretest.test`;
  assert.ifError((await owner.db.from('invitations').insert([{ organization_id: orgId, email, invited_by: owner.id }, { organization_id: orgId, email: fresh, invited_by: owner.id }])).error);
  assert.ifError((await admin().from('invitations').update({ created_at: new Date(Date.now() - 31 * DAY).toISOString() }).eq('organization_id', orgId).eq('email', email)).error);

  // Signing up with the expired address joins nothing.
  const created = await admin().auth.admin.createUser({ email, email_confirm: true });
  assert.ifError(created.error);
  const { data: link } = await admin().auth.admin.generateLink({ type: 'magiclink', email });
  const db = anon();
  assert.ifError((await db.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: 'email' })).error);
  assert.equal((await db.rpc('claim_invitations')).data, 0);
  assert.equal((await admin().from('members').select('user_id').eq('organization_id', orgId).eq('user_id', created.data.user!.id)).data?.length, 0);

  assert.ifError((await admin().from('invitations').insert({ organization_id: orgId, email: `old-${randomUUID().slice(0, 8)}@it.flowretest.test`, created_at: new Date(Date.now() - 31 * DAY).toISOString() })).error);
  assert.ifError((await admin().rpc('purge_expired_runs')).error);
  const left = (await admin().from('invitations').select('email').eq('organization_id', orgId)).data!.map((i) => i.email);
  assert.deepEqual(left, [fresh]);
});

test('DPA acceptances: owners only, members read them, outsiders see nothing, rows cannot be edited', { skip: skipDb }, async () => {
  const args = { p_org: orgId, p_version: DPA_VERSION, p_company_name: 'Data Agency Sp. z o.o.', p_company_address: 'ul. Złota 44, Warszawa', p_company_id: '', p_signer_name: 'Anna Nowak', p_signer_role: 'CEO' };
  assert.equal((await member.db.rpc('accept_dpa', args)).error?.code, '42501');
  assert.equal((await outsider.db.rpc('accept_dpa', args)).error?.code, '42501');
  assert.equal((await anon().rpc('accept_dpa', args)).error?.code, '42501');
  assert.equal((await owner.db.rpc('accept_dpa', { ...args, p_version: 'latest' })).error?.code, '23514', 'versions are dates');
  const id = (await owner.db.rpc('accept_dpa', args)).data as string;
  assert.ok(id);
  const row = (await member.db.from('dpa_acceptances').select('*').eq('id', id).single()).data!;
  assert.equal(row.signer_email, owner.email, 'the signer is the signed-in owner, not a form field');
  assert.equal(row.company_id, null);
  assert.equal((await outsider.db.from('dpa_acceptances').select('id').eq('organization_id', orgId)).data?.length, 0);
  assert.equal((await owner.db.from('dpa_acceptances').update({ company_name: 'Other' }).eq('id', id).select('id')).error?.code, '42501', 'no update grant');
  assert.equal((await owner.db.from('dpa_acceptances').delete().eq('id', id).select('id')).error?.code, '42501', 'no delete grant');
});

test('the last owner cannot leave; with a second owner they can', { skip: skipDb }, async () => {
  const solo = await user('solo-owner');
  const org = (await solo.db.rpc('create_organization', { p_name: 'Solo' })).data as string;
  assert.ok((await solo.db.from('members').delete().eq('organization_id', org).eq('user_id', solo.id)).error, 'the only owner stays');
  assert.ifError((await admin().from('members').insert({ organization_id: org, user_id: member.id, email: member.email, role: 'member' })).error);
  assert.ifError((await solo.db.from('members').update({ role: 'owner' }).eq('organization_id', org).eq('user_id', member.id)).error);
  assert.ifError((await solo.db.from('members').delete().eq('organization_id', org).eq('user_id', solo.id)).error);
});

test('export: owners get every row as JSON Lines; members 403, outsiders 404, visitors the login page', { skip: skipApp }, async () => {
  await runsAged([1, 2]);
  const get = (cookie?: string) => fetch(`${appUrl}/o/${orgId}/export`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const res = await get(owner.cookie);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="flowretest-data-agency-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.jsonl"$/);
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as { type: string; data: Record<string, unknown> });
  assert.equal(lines[0]!.type, 'export');
  const count = (type: string) => lines.filter((l) => l.type === type).length;
  assert.equal(count('organization'), 1);
  assert.equal(count('run'), 2);
  assert.equal(count('member'), 2);
  assert.ok(count('workspace_token') >= 1);
  assert.ok(lines.every((l) => l.type !== 'error'));
  assert.ok(!lines.some((l) => l.type === 'workspace_token' && 'token_hash' in l.data), 'token hashes never leave');
  assert.ok(lines.find((l) => l.type === 'run')!.data.report, 'runs carry their redacted report');

  assert.equal((await get(member.cookie)).status, 403);
  assert.equal((await get(outsider.cookie)).status, 404);
  const visitor = await get();
  assert.ok([302, 307].includes(visitor.status) && (visitor.headers.get('location') ?? '').includes('/login'));
});

test('DPA copy: a PDF for members, 404 for outsiders', { skip: skipApp }, async () => {
  const { data } = await admin().from('dpa_acceptances').select('id').eq('organization_id', orgId).limit(1).single();
  const id = data?.id ?? ((await owner.db.rpc('accept_dpa', { p_org: orgId, p_version: DPA_VERSION, p_company_name: 'X', p_company_address: 'Y', p_company_id: '', p_signer_name: 'Z', p_signer_role: 'W' })).data as string);
  const get = (cookie: string) => fetch(`${appUrl}/o/${orgId}/dpa/${id}/pdf`, { headers: { cookie }, redirect: 'manual' });
  const res = await get(member.cookie);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal((await get(outsider.cookie)).status, 404);
});

test('public pages: home, pricing and every legal text without a session; signed-in visitors of / go to /orgs', { skip: skipApp }, async () => {
  for (const path of ['/', '/pricing', ...LEGAL_SLUGS.map((s) => `/legal/${s}`)]) {
    const res = await fetch(`${appUrl}${path}`, { redirect: 'manual' });
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, /\/legal\/dpa/, `${path} links the DPA`);
  }
  assert.equal((await fetch(`${appUrl}/legal/nope`)).status, 404);
  const signedIn = await fetch(`${appUrl}/`, { headers: { cookie: owner.cookie }, redirect: 'manual' });
  assert.ok([302, 307].includes(signedIn.status) && (signedIn.headers.get('location') ?? '').endsWith('/orgs'));
});
