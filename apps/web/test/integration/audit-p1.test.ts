/**
 * P1 fixes of docs/audyt-2026-09-25.md that need the database or the upload API: an organization keeps an owner, a
 * report without cases is refused, the body limit holds without Content-Length, the token is checked first, sign-in
 * attempts are limited per address and per client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { generateToken } from '../../lib/tokens.ts';
import { admin, appMissing, appUrl, supabaseMissing, user, mustRun } from './helpers.ts';

const skip = mustRun(await supabaseMissing());
const skipApi = mustRun(skip ?? (await appMissing()));

test('the last owner can neither leave nor step down; handing over first works, and so does deleting the organization', { skip }, async () => {
  const owner = await user('p1-owner');
  const member = await user('p1-member');
  const orgId = (await owner.db.rpc('create_organization', { p_name: 'P1 Owners' })).data as string;
  assert.ifError((await owner.db.from('invitations').insert({ organization_id: orgId, email: member.email, invited_by: owner.id })).error);
  await member.db.rpc('claim_invitations');

  const leave = await owner.db.from('members').delete().eq('organization_id', orgId).eq('user_id', owner.id);
  assert.equal(leave.error?.code, '42501', 'the only owner left');
  const demote = await owner.db.from('members').update({ role: 'member' }).eq('organization_id', orgId).eq('user_id', owner.id);
  assert.equal(demote.error?.code, '42501', 'the only owner stepped down');

  assert.ifError((await owner.db.from('members').update({ role: 'owner' }).eq('organization_id', orgId).eq('user_id', member.id)).error);
  assert.ifError((await owner.db.from('members').delete().eq('organization_id', orgId).eq('user_id', owner.id)).error);
  const left = await admin().from('members').select('user_id, role').eq('organization_id', orgId);
  assert.deepEqual(left.data, [{ user_id: member.id, role: 'owner' }]);

  assert.ifError((await member.db.from('organizations').delete().eq('id', orgId)).error);
});

async function token(): Promise<string> {
  const owner = await user('p1-api');
  const orgId = (await owner.db.rpc('create_organization', { p_name: 'P1 Api' })).data as string;
  const ws = await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Acme' }).select('id').single();
  const t = generateToken();
  assert.ifError((await owner.db.from('workspace_tokens').insert({ workspace_id: ws.data!.id, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id })).error);
  return t.token;
}

/** A POST with Transfer-Encoding: chunked and no Content-Length, as a client that streams the body sends it. */
function chunked(bearer: string, chunks: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', (e) => ((e as NodeJS.ErrnoException).code === 'ECONNRESET' || (e as NodeJS.ErrnoException).code === 'EPIPE' ? resolve(413) : reject(e)));
    for (const c of chunks) req.write(c);
    req.end();
  });
}

test('upload API: token before body, no body past 5 MB even without Content-Length, no report without cases', { skip: skipApi }, async () => {
  const good = await token();
  const fake = generateToken().token;
  // A well-formed unknown token is refused before the body is looked at.
  assert.equal(await chunked(fake, ['not json']), 401);
  const mb = 'x'.repeat(1024 * 1024);
  assert.equal(await chunked(good, [mb, mb, mb, mb, mb, mb]), 413);

  const empty: PlanReport = { runner: '0.3.0', workflowName: 'Empty', workflowId: 'wf-empty', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'o', newLabel: 'n', cases: [], coverage: { writeNodesTotal: 0, writeNodesCaptured: 0, replayedNodes: 0, unsupported: [] }, sealed: true };
  const res = await fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${good}`, 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redactPlanReport(empty) }) });
  assert.equal(res.status, 422);
  assert.match(((await res.json()) as { error: string }).error, /no cases/);
});

test('sign-in limits: 5 codes per address and 20 per client in 15 minutes, counted by the server only', { skip }, async () => {
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}-${Date.now()}`;
  const email = `p1-limit-${Date.now()}@it.flowretest.test`;
  const note = (e: string, kind = 'send', from = ip) => admin().rpc('note_sign_in_attempt', { p_kind: kind, p_email: e, p_ip: from });
  for (let i = 0; i < 5; i++) assert.equal((await note(email)).data, true);
  assert.equal((await note(email)).data, false, 'a sixth code for one address');
  assert.equal((await note(email.toUpperCase())).data, false, 'the address is compared in lower case');
  assert.equal((await note(email, 'verify')).data, true, 'entering a code is counted apart from sending one');
  for (let i = 0; i < 15; i++) assert.equal((await note(`p1-other-${i}-${Date.now()}@it.flowretest.test`)).data, true);
  assert.equal((await note(`p1-last-${Date.now()}@it.flowretest.test`)).data, false, 'a 21st code from one client');
  assert.equal((await note(`p1-else-${Date.now()}@it.flowretest.test`, 'send', `${ip}-b`)).data, true, 'another client is not affected');
  const signedIn = await user('p1-limit-user');
  assert.ok((await signedIn.db.rpc('note_sign_in_attempt', { p_kind: 'send', p_email: 'x@y.z', p_ip: 'x' })).error, 'people cannot call it');
});

test('two runs of a workflow compare side by side for members; outsiders and runs of another workflow get 404', { skip: skipApi }, async () => {
  const owner = await user('p1-compare');
  const outsider = await user('p1-compare-out');
  const orgId = (await owner.db.rpc('create_organization', { p_name: 'P1 Compare' })).data as string;
  const ws = (await owner.db.from('workspaces').insert({ organization_id: orgId, name: 'Acme' }).select('id').single()).data!.id;
  const t = generateToken();
  assert.ifError((await owner.db.from('workspace_tokens').insert({ workspace_id: ws, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id })).error);
  const rec = (version: string, path: string): CaptureRecord => ({ ts: 1, version, case: '1', method: 'POST', host: 'crm.example.com', port: 443, path, query: {}, headers: {}, bodyJson: { a: 1 }, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } });
  const upload = async (workflowId: string, paths: string[]) => {
    const d = diffCase('1', [normalizeCall(rec('old', '/contacts'), { node: 'Push', runIndex: 0 })], paths.map((p) => normalizeCall(rec('new', p), { node: 'Push', runIndex: 0 })));
    const report: PlanReport = { runner: '0.3.0', workflowName: 'Compare', workflowId, engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'o', newLabel: 'n', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
    const res = await fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redactPlanReport(report) }) });
    assert.equal(res.status, 201, await res.clone().text());
    return ((await res.json()) as { id: string }).id;
  };
  const first = await upload('wf-compare', ['/contacts']);
  const second = await upload('wf-compare', ['/contacts', '/tasks']);
  const other = await upload('wf-other', ['/contacts']);
  const wf = (await owner.db.from('runs').select('workflow_id').eq('id', first).single()).data!.workflow_id;
  const page = (a: string, b: string, cookie: string) => fetch(`${appUrl}/w/${ws}/workflows/${wf}/compare?a=${a}&b=${b}`, { headers: { cookie } });

  const res = await page(first, second, owner.cookie);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /The only case differs/);
  assert.match(html, /crm\.example\.com\/tasks/);
  assert.equal((await page(first, second, outsider.cookie)).status, 404);
  assert.equal((await page(first, other, owner.cookie)).status, 404);
});
