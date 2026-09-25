/** POST /api/runs through the running app: status codes, privacy guard and who can read the stored run. */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { generateToken } from '../../lib/tokens.ts';
import { appMissing, appUrl, supabaseMissing, user, type Db, mustRun } from './helpers.ts';

const skip = mustRun((await supabaseMissing()) ?? (await appMissing()));

let owner: { db: Db; id: string };
let outsider: { db: Db };
let token: string;
let tokenId: string;

before(async () => {
  if (skip) return;
  owner = await user('api-owner');
  outsider = await user('api-outsider');
  const org = await owner.db.rpc('create_organization', { p_name: 'API Agency' });
  const ws = await owner.db.from('workspaces').insert({ organization_id: org.data as string, name: 'Customer' }).select('id').single();
  const t = generateToken();
  const created = await owner.db.from('workspace_tokens').insert({ workspace_id: ws.data!.id, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id }).select('id').single();
  assert.ifError(created.error);
  token = t.token;
  tokenId = created.data!.id;
});

function report(): PlanReport {
  const rec = (version: string, email: string): CaptureRecord => ({ ts: 1, version, case: '9', method: 'POST', host: 'crm.example.com', port: 443, path: '/contacts', query: {}, headers: {}, bodyJson: { email }, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } });
  const d = diffCase('9', [normalizeCall(rec('old', 'anna@firma.pl'), { node: 'Push', runIndex: 0 })], [normalizeCall(rec('new', 'ola@firma.pl'), { node: 'Push', runIndex: 0 })]);
  return { runner: '0.3.0', workflowName: 'Lead intake', workflowId: 'api-wf', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
}

function post(body: unknown, auth?: string) {
  return fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

const envelope = (r: PlanReport) => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...r });

test('a redacted report is stored for the token workspace and readable by its members only', { skip }, async () => {
  const res = await post(envelope(redactPlanReport(report())), `Bearer ${token}`);
  assert.equal(res.status, 201, await res.clone().text());
  const json = (await res.json()) as { id: string; url: string; status: string };
  assert.equal(json.status, 'DIFF');
  assert.equal(json.url, `${appUrl}/runs/${json.id}`);
  const mine = await owner.db.from('runs').select('status, report').eq('id', json.id).single();
  assert.equal(mine.data?.status, 'DIFF');
  assert.ok(!JSON.stringify(mine.data?.report).includes('firma.pl'));
  assert.equal((await outsider.db.from('runs').select('id').eq('id', json.id)).data?.length, 0);
  const wf = await owner.db.from('workflows').select('n8n_workflow_id, last_status').eq('n8n_workflow_id', 'api-wf').single();
  assert.deepEqual(wf.data, { n8n_workflow_id: 'api-wf', last_status: 'DIFF' });
  const tok = await owner.db.from('workspace_tokens').select('last_used_at').eq('id', tokenId).single();
  assert.ok(tok.data?.last_used_at);
});

test('refusals: 401 without or with a wrong token, 422 with values left in, 400 for another format', { skip }, async () => {
  assert.equal((await post(envelope(redactPlanReport(report())))).status, 401);
  assert.equal((await post(envelope(redactPlanReport(report())), `Bearer ${generateToken().token}`)).status, 401);
  const raw = await post(envelope(report()), `Bearer ${token}`);
  assert.equal(raw.status, 422);
  assert.ok(((await raw.json()) as { details: string[] }).details.some((d) => d.includes('body.email')));
  assert.equal((await post({ hello: 'world' }, `Bearer ${token}`)).status, 400);
  assert.equal((await post('not json', `Bearer ${token}`)).status, 400);
});

test('a revoked token stops working at once', { skip }, async () => {
  const t = generateToken();
  const ws = await owner.db.from('workspaces').select('id').limit(1).single();
  const created = await owner.db.from('workspace_tokens').insert({ workspace_id: ws.data!.id, name: 'tmp', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id }).select('id').single();
  assert.equal((await post(envelope(redactPlanReport(report())), `Bearer ${t.token}`)).status, 201);
  await owner.db.from('workspace_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', created.data!.id);
  assert.equal((await post(envelope(redactPlanReport(report())), `Bearer ${t.token}`)).status, 401);
});

test('app pages send signed-out visitors to the login page', { skip }, async () => {
  const res = await fetch(`${appUrl}/runs/00000000-0000-0000-0000-000000000000`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  assert.match(res.headers.get('location') ?? '', /\/login\?next=%2Fruns%2F/);
});
