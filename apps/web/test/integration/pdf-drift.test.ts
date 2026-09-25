/**
 * Week 13 through the running app: the PDF record of a run (Agency only), the engine drift matrix built from uploaded
 * upgrade-check runs, and the public pricing page.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { generateToken } from '../../lib/tokens.ts';
import { admin, appMissing, appUrl, setPlan, supabaseMissing, user, mustRun } from './helpers.ts';

const skip = mustRun((await supabaseMissing()) ?? (await appMissing()));

let owner: Awaited<ReturnType<typeof user>>;
let outsider: Awaited<ReturnType<typeof user>>;
let orgId: string;
let workspaceId: string;
let token: string;

before(async () => {
  if (skip) return;
  owner = await user('pdf-owner');
  outsider = await user('pdf-outsider');
  const org = await owner.db.rpc('create_organization', { p_name: `Drift Agency ${randomUUID().slice(0, 6)}` });
  orgId = org.data as string;
  const ws = await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Customer' }).select('id').single();
  workspaceId = ws.data!.id;
  const t = generateToken();
  assert.ifError((await owner.db.from('workspace_tokens').insert({ workspace_id: workspaceId, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id })).error);
  token = t.token;
});

function rec(version: string, email: string): CaptureRecord {
  return { ts: 1, version, case: '1', method: 'POST', host: 'crm.example.com', port: 443, path: '/contacts', query: {}, headers: {}, bodyJson: { email }, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
}

/** A change run (DIFF) or an upgrade-check run from 2.40.5 to `engineNew` with the given status. */
async function upload(workflowId: string, upgrade?: { engineNew: string; diff: boolean }): Promise<string> {
  const node = 'Wyślij do CRM';
  const d = diffCase('1', [normalizeCall(rec('old', 'anna@firma.pl'), { node, runIndex: 0 })], [normalizeCall(rec('new', upgrade && !upgrade.diff ? 'anna@firma.pl' : 'ola@firma.pl'), { node, runIndex: 0 })]);
  const report: PlanReport = { runner: '0.3.0', workflowName: `Flow ${workflowId}`, workflowId, engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
  const body = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redactPlanReport(report),
    ...(upgrade ? { upgrade: { engineOld: 'n8nio/n8n:2.40.5', engineNew: `n8nio/n8n:${upgrade.engineNew}` } } : {}),
  };
  const res = await fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { id: string }).id;
}

test('the PDF record: refused below Agency, a named attachment on Agency, a 404 for outsiders', { skip }, async () => {
  const runId = await upload('pdf-wf');
  const get = (cookie: string) => fetch(`${appUrl}/runs/${runId}/pdf`, { headers: { cookie }, redirect: 'manual' });

  const free = await get(owner.cookie);
  assert.equal(free.status, 402);
  assert.match(((await free.json()) as { error: string }).error, /not part of the free plan/);
  assert.doesNotMatch(await (await fetch(`${appUrl}/runs/${runId}`, { headers: { cookie: owner.cookie } })).text(), /Download PDF record/);

  await setPlan(orgId, 'agency');
  const res = await get(owner.cookie);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="flowretest-flow-pdf-wf-\d{4}-\d{2}-\d{2}-diff\.pdf"$/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const pdf = Buffer.from(await res.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(await (await fetch(`${appUrl}/runs/${runId}`, { headers: { cookie: owner.cookie } })).text(), /Download PDF record/);

  assert.equal((await get(outsider.cookie)).status, 404);
  const anonymous = await fetch(`${appUrl}/runs/${runId}/pdf`, { redirect: 'manual' });
  assert.ok([302, 307].includes(anonymous.status) && (anonymous.headers.get('location') ?? '').includes('/login'), 'signed-out visitors go to the login page');
});

test('drift matrix: the latest upgrade-check per workflow and target version, members only', { skip }, async () => {
  await setPlan(orgId, 'agency');
  await upload('drift-a', { engineNew: '2.41.0', diff: true });
  const latest = await upload('drift-a', { engineNew: '2.41.0', diff: false });
  await upload('drift-a', { engineNew: 'next', diff: true });
  await upload('drift-b', { engineNew: '2.41.0', diff: true });
  await upload('drift-change', undefined);

  const cells = (await owner.db.from('latest_upgrade_runs').select('id, status, engine_from, engine_to, workflow_id').eq('workspace_id', workspaceId)).data!;
  assert.equal(cells.length, 3, 'two workflows, drift-a against two versions; change runs are not cells');
  const a241 = cells.filter((c) => c.engine_to === 'n8nio/n8n:2.41.0');
  assert.equal(a241.length, 2);
  assert.ok(a241.some((c) => c.id === latest && c.status === 'PASS'), 'the newer run replaces the older one');
  assert.ok(cells.every((c) => c.engine_from === 'n8nio/n8n:2.40.5'));
  assert.equal((await outsider.db.from('latest_upgrade_runs').select('id').eq('workspace_id', workspaceId)).data?.length, 0);

  const page = await (await fetch(`${appUrl}/w/${workspaceId}/drift`, { headers: { cookie: owner.cookie } })).text();
  assert.match(page, /n8n 2\.41\.0/);
  assert.match(page, /n8n next/);
  assert.ok(page.indexOf('n8n 2.41.0') < page.indexOf('n8n next'), 'numeric versions before named tags');
  const orgPage = await (await fetch(`${appUrl}/o/${orgId}/drift`, { headers: { cookie: owner.cookie } })).text();
  assert.match(orgPage, /1 DIFF · 1 PASS/);

  await setPlan(orgId, 'team');
  assert.match(await (await fetch(`${appUrl}/w/${workspaceId}/drift`, { headers: { cookie: owner.cookie } })).text(), /comes with the Agency plan/);
  assert.equal((await fetch(`${appUrl}/o/${orgId}/drift`, { headers: { cookie: outsider.cookie } })).status, 404);
});

test('plans: PDF and drift come with Agency only; the pricing page is public and shows the prices', { skip }, async () => {
  const plans = (await admin().from('plans').select('id, pdf_export, drift_matrix').order('sort')).data!;
  assert.deepEqual(plans.map((p) => [p.id, p.pdf_export, p.drift_matrix]), [['free', false, false], ['team', false, false], ['agency', true, true]]);
  const res = await fetch(`${appUrl}/pricing`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const text of ['79 EUR', '758.40 EUR', '199 EUR', '1910.40 EUR', 'PDF record of what each run would send', 'Prices exclude VAT']) assert.ok(html.includes(text), text);
});
