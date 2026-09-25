/** Week 10 through the running app: accepting in the app, the runner's sync endpoints, email notifications. */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { generateToken } from '../../lib/tokens.ts';
import { admin, appMissing, appUrl, supabaseMissing, user, type Db, mustRun } from './helpers.ts';

const skip = mustRun((await supabaseMissing()) ?? (await appMissing()));

let owner: { db: Db; id: string; email: string };
let outsider: { db: Db; id: string };
let token: string;
let otherToken: string;
let workspaceId: string;
const WORKFLOW = `wf-${Date.now()}`;

function report(): PlanReport {
  const rec = (version: string, caseId: string, email: string): CaptureRecord => ({ ts: 1, version, case: caseId, method: 'POST', host: 'crm.example.com', port: 443, path: '/contacts', query: {}, headers: {}, bodyJson: { email }, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } });
  const c = (id: string) => diffCase(id, [normalizeCall(rec('old', id, 'anna@firma.pl'), { node: 'Push', runIndex: 0 })], [normalizeCall(rec('new', id, 'ola@firma.pl'), { node: 'Push', runIndex: 0 })]);
  return { runner: '0.3.0', workflowName: 'Lead intake', workflowId: WORKFLOW, engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [c('9'), c('10')], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
}

async function upload(tok: string): Promise<string> {
  const body = { schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, run: '2026-09-24T10-00-00', workflowVersionId: 'dddd0000-0000-4000-8000-000000000004', stability: { '9': true, '10': false }, ...redactPlanReport(report()) };
  const res = await fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { id: string }).id;
}

function api(path: string, tok: string, init: { method?: string; body?: unknown } = {}) {
  return fetch(`${appUrl}${path}`, { method: init.method ?? 'GET', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

before(async () => {
  if (skip) return;
  owner = await user('acc-owner');
  outsider = await user('acc-outsider');
  const tokenFor = async (u: { db: Db; id: string }, name: string) => {
    const org = await u.db.rpc('create_organization', { p_name: name });
    const ws = await u.db.from('workspaces').insert({ organization_id: org.data as string, name: 'Customer' }).select('id').single();
    const t = generateToken();
    const created = await u.db.from('workspace_tokens').insert({ workspace_id: ws.data!.id, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: u.id });
    assert.ifError(created.error);
    return { token: t.token, workspaceId: ws.data!.id };
  };
  const mine = await tokenFor(owner, 'Acceptance Agency');
  token = mine.token;
  workspaceId = mine.workspaceId;
  otherToken = (await tokenFor(outsider, 'Other Agency')).token;
});

test('only stable PASS or DIFF cases can be accepted, by members only; the runner sees and applies the acceptance once', { skip }, async () => {
  const runId = await upload(token);
  const unstable = await owner.db.rpc('accept_run', { p_run_id: runId, p_case_ids: ['10'], p_message: '' });
  assert.match(unstable.error?.message ?? '', /case 10 was not proven stable/);
  const missing = await owner.db.rpc('accept_run', { p_run_id: runId, p_case_ids: ['77'], p_message: '' });
  assert.match(missing.error?.message ?? '', /case 77 is not in this run/);
  const foreign = await outsider.db.rpc('accept_run', { p_run_id: runId, p_case_ids: ['9'], p_message: '' });
  assert.ok(foreign.error, 'outsider accepted');

  const accepted = await owner.db.rpc('accept_run', { p_run_id: runId, p_case_ids: ['9'], p_message: 'field moved to the new CRM property' });
  assert.ifError(accepted.error);
  const history = await owner.db.from('acceptances').select('case_ids, message, accepted_by_email, local_run, applied_at').eq('id', accepted.data as string).single();
  assert.deepEqual(history.data, { case_ids: ['9'], message: 'field moved to the new CRM property', accepted_by_email: owner.email, local_run: '2026-09-24T10-00-00', applied_at: null });
  assert.equal((await owner.db.from('acceptances').insert({} as never)).error !== null, true, 'people cannot write acceptances directly');

  const pending = (await (await api(`/api/acceptances?workflow=${WORKFLOW}`, token)).json()) as { acceptances: Array<{ id: string; caseIds: string[]; acceptedBy: string; localRun: string; workflowVersionId: string }> };
  // The acceptance records the workflow version the run tested (plan section 11).
  assert.deepEqual(pending.acceptances.map((a) => [a.id, a.caseIds, a.acceptedBy, a.localRun, a.workflowVersionId]), [[accepted.data, ['9'], owner.email, '2026-09-24T10-00-00', 'dddd0000-0000-4000-8000-000000000004']]);
  const otherView = (await (await api(`/api/acceptances?workflow=${WORKFLOW}`, otherToken)).json()) as { acceptances: unknown[] };
  assert.equal(otherView.acceptances.length, 0, 'another workspace sees the acceptance');
  assert.equal((await api(`/api/acceptances/${accepted.data}/applied`, otherToken, { method: 'POST', body: { appliedCases: ['9'] } })).status, 409);

  assert.equal((await api(`/api/acceptances/${accepted.data}/applied`, token, { method: 'POST', body: { appliedCases: ['9'] } })).status, 200);
  assert.equal((await api(`/api/acceptances/${accepted.data}/applied`, token, { method: 'POST', body: { appliedCases: ['9'] } })).status, 409);
  const after = (await (await api(`/api/acceptances?workflow=${WORKFLOW}`, token)).json()) as { acceptances: unknown[] };
  assert.equal(after.acceptances.length, 0);
  const applied = await owner.db.from('acceptances').select('applied_cases, applied_at').eq('id', accepted.data as string).single();
  assert.deepEqual(applied.data?.applied_cases, ['9']);

  assert.equal((await api(`/api/acceptances?workflow=${WORKFLOW}`, generateToken().token)).status, 401);
  assert.equal((await api('/api/acceptances', token)).status, 400);
});

test('a subscribed member gets an email about a DIFF run, an unsubscribed one does not', { skip }, async () => {
  const sub = await owner.db.from('notification_subscriptions').insert({ workspace_id: workspaceId, user_id: owner.id, statuses: ['DIFF'] });
  assert.ifError(sub.error);
  const foreign = await outsider.db.from('notification_subscriptions').insert({ workspace_id: workspaceId, user_id: outsider.id, statuses: ['DIFF'] });
  assert.ok(foreign.error, 'outsider subscribed to a foreign workspace');
  const runId = await upload(token);
  // Sent after the response (next/server after); poll the log.
  let rows: Array<{ recipient: string; ok: boolean; detail: string | null }> = [];
  for (let i = 0; i < 40 && rows.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 250));
    rows = (await admin().from('notification_log').select('recipient, ok, detail').eq('run_id', runId)).data ?? [];
  }
  assert.equal(rows.length, 1, 'one email');
  assert.equal(rows[0]?.recipient, owner.email);
  assert.equal(rows[0]?.ok, true, rows[0]?.detail ?? '');
  const mailpit = process.env.MAILPIT_URL;
  if (mailpit && rows[0]?.detail?.startsWith('mailpit')) {
    const found = (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${owner.email}`)}`)).json()) as { messages: Array<{ Subject: string }> };
    assert.ok(found.messages.some((m) => m.Subject === '[FlowRetest] DIFF: Lead intake (Customer)'), JSON.stringify(found.messages.map((m) => m.Subject)));
  }
});
