/**
 * Week 11 through the running app and scripts/fake-services.mjs: linking a GitHub installation (install page, OAuth,
 * ownership check), a check on the tested commit after an upload, Slack messages, installation webhooks.
 * Needs `node scripts/fake-services.mjs init` before starting the app and `... serve` running.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { generateToken } from '../../lib/tokens.ts';
import { admin, appMissing, appUrl, supabaseMissing, user, type Db } from './helpers.ts';

const fakeUrl = process.env.GITHUB_APP_WEB_URL ?? '';
async function fakeMissing(): Promise<string | undefined> {
  if (!fakeUrl || !process.env.GITHUB_APP_WEBHOOK_SECRET) return 'no fake GitHub App in .env.local (node scripts/fake-services.mjs init)';
  try {
    await fetch(`${fakeUrl}/__calls`, { signal: AbortSignal.timeout(2000) });
  } catch {
    return `fake services not reachable at ${fakeUrl} (node scripts/fake-services.mjs serve)`;
  }
  // The app must have been started with the same settings.
  const res = await fetch(`${appUrl}/api/github/webhook`, { method: 'POST', body: '{}' });
  return res.status === 404 ? 'the app runs without the GitHub App settings; restart it after fake-services init' : undefined;
}
const skip = (await supabaseMissing()) ?? (await appMissing()) ?? (await fakeMissing());

let owner: { db: Db; id: string; email: string; cookie: string };
let outsider: { db: Db; id: string; cookie: string };
let workspaceId: string;
let token: string;

before(async () => {
  if (skip) return;
  owner = await user('gh-owner');
  outsider = await user('gh-outsider');
  const org = await owner.db.rpc('create_organization', { p_name: 'GitHub Agency' });
  const ws = await owner.db.from('workspaces').insert({ organization_id: org.data as string, name: 'Acme' }).select('id').single();
  workspaceId = ws.data!.id;
  const t = generateToken();
  const created = await owner.db.from('workspace_tokens').insert({ workspace_id: workspaceId, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: owner.id });
  assert.ifError(created.error);
  token = t.token;
});

/** One hop of a redirect chain; the app gets the session cookie, the fake GitHub does not. */
async function hop(url: string, cookie?: string): Promise<string> {
  const res = await fetch(url, { redirect: 'manual', headers: cookie && url.startsWith(appUrl) ? { cookie } : {} });
  assert.ok([302, 303, 307, 308].includes(res.status), `${url} answered ${res.status}`);
  return new URL(res.headers.get('location') ?? '', url).toString();
}

/** Install page, setup URL, OAuth authorize, setup URL again; `as` picks the GitHub user who authorizes. */
async function link(cookie: string, as = 'agency-dev'): Promise<string> {
  let url = await hop(`${appUrl}/api/github/install?workspace=${workspaceId}`, cookie);
  assert.ok(url.startsWith(`${fakeUrl}/apps/`), url);
  url = await hop(url);
  url = await hop(url, cookie);
  assert.ok(url.startsWith(`${fakeUrl}/login/oauth/authorize`), url);
  url = await hop(`${url}&as=${as}`);
  return hop(url, cookie);
}

function report(workflowId: string): PlanReport {
  const rec = (version: string, email: string): CaptureRecord => ({ ts: 1, version, case: '1', method: 'POST', host: 'crm.example.com', port: 443, path: '/contacts', query: {}, headers: {}, bodyJson: { email }, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } });
  const d = diffCase('1', [normalizeCall(rec('old', 'anna@firma.pl'), { node: 'Push', runIndex: 0 })], [normalizeCall(rec('new', 'ola@firma.pl'), { node: 'Push', runIndex: 0 })]);
  return { runner: '0.3.0', workflowName: 'Lead intake', workflowId, engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
}

async function upload(repository: string): Promise<string> {
  const body = { schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redactPlanReport(report('gh-wf')), git: { repository, sha: 'c'.repeat(40), pullRequest: 7 } };
  const res = await fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { id: string }).id;
}

async function poll<T>(read: () => Promise<T[]>): Promise<T[]> {
  for (let i = 0; i < 40; i++) {
    const rows = await read();
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

test('an installation is linked only for an owner whose GitHub account can access it', { skip }, async () => {
  assert.match(await link(outsider.cookie).catch(() => 'refused'), /refused|owner-only/);
  assert.match(await link(owner.cookie, 'intruder'), /github=not-yours/);
  assert.equal((await owner.db.from('github_installations').select('installation_id').eq('workspace_id', workspaceId)).data?.length, 0);

  assert.match(await link(owner.cookie), /github=linked/);
  const rows = await owner.db.from('github_installations').select('installation_id, account_login, account_type').eq('workspace_id', workspaceId);
  assert.deepEqual(rows.data, [{ installation_id: 1001, account_login: 'acme-agency', account_type: 'Organization' }]);
  assert.equal((await outsider.db.from('github_installations').select('installation_id')).data?.length, 0);

  // A valid state stolen from the owner does not work in another session.
  const install = await hop(`${appUrl}/api/github/install?workspace=${workspaceId}`, owner.cookie);
  const setup = await hop(install);
  assert.match(await hop(setup, outsider.cookie), /github=owner-only/);
  assert.match(await hop(`${appUrl}/api/github/setup?installation_id=1001&state=forged.state`, owner.cookie), /github=expired/);
});

test('an upload from a linked repository gets a check on the tested commit; other owners get a logged refusal', { skip }, async () => {
  const runId = await upload('acme-agency/flows');
  const checks = await poll(async () => (await owner.db.from('github_checks').select('ok, conclusion, html_url, detail').eq('run_id', runId)).data ?? []);
  assert.equal(checks[0]?.ok, true, checks[0]?.detail ?? '');
  assert.equal(checks[0]?.conclusion, 'action_required');
  assert.match(checks[0]?.html_url ?? '', /acme-agency\/flows\/runs\//);
  const run = await owner.db.from('runs').select('git_repository, git_sha, pull_request').eq('id', runId).single();
  assert.deepEqual(run.data, { git_repository: 'acme-agency/flows', git_sha: 'c'.repeat(40), pull_request: 7 });
  const calls = (await (await fetch(`${fakeUrl}/__calls`)).json()) as Array<{ path: string; body: { head_sha?: string; output?: { summary?: string } } }>;
  const posted = calls.filter((c) => c.path === '/api/repos/acme-agency/flows/check-runs').pop();
  assert.equal(posted?.body.head_sha, 'c'.repeat(40));
  assert.ok(!JSON.stringify(posted?.body).includes('firma.pl'), 'values reached GitHub');
  assert.match(posted?.body.output?.summary ?? '', new RegExp(`${appUrl.replace(/[.:/]/g, '\\$&')}/runs/${runId}`));

  const other = await upload('other-org/flows');
  const refused = await poll(async () => (await owner.db.from('github_checks').select('ok, detail').eq('run_id', other)).data ?? []);
  assert.deepEqual(refused, [{ ok: false, detail: 'no GitHub App installation for other-org is linked to this workspace' }]);
});

test('Slack: owners add only Slack webhooks, members never read the URL, subscribers get the run', { skip }, async () => {
  const slackUrl = `${fakeUrl}/slack/services/T1/B2/secretsecret`;
  const intruder = await outsider.db.from('slack_webhooks').insert({ workspace_id: workspaceId, url: slackUrl, url_hint: 'x', statuses: ['DIFF'], created_by: outsider.id });
  assert.ok(intruder.error, 'outsider added a webhook');
  const added = await owner.db.from('slack_webhooks').insert({ workspace_id: workspaceId, url: slackUrl, url_hint: '127.0.0.1/slack/services/T1/B2/secr…', statuses: ['DIFF'], created_by: owner.id });
  assert.ifError(added.error);
  assert.ok((await owner.db.from('slack_webhooks').select('url')).error, 'owner read the webhook URL back');
  await fetch(`${fakeUrl}/__calls`, { method: 'DELETE' });
  const runId = await upload('acme-agency/flows');
  const logged = await poll(async () => (await admin().from('notification_log').select('recipient, ok').eq('run_id', runId).eq('channel', 'slack')).data ?? []);
  assert.deepEqual(logged, [{ recipient: '127.0.0.1/slack/services/T1/B2/secr…', ok: true }]);
  const calls = (await (await fetch(`${fakeUrl}/__calls`)).json()) as Array<{ path: string; body: { text?: string } }>;
  const message = calls.find((c) => c.path === '/slack/services/T1/B2/secretsecret');
  assert.match(message?.body.text ?? '', /^\*DIFF\* · Run of "Lead intake" in Acme/);
});

test('installation webhooks are signed; uninstalling on GitHub unlinks the workspace', { skip }, async () => {
  const deliver = (payload: unknown, secret = process.env.GITHUB_APP_WEBHOOK_SECRET as string) => {
    const raw = JSON.stringify(payload);
    return fetch(`${appUrl}/api/github/webhook`, { method: 'POST', headers: { 'x-github-event': 'installation', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`, 'content-type': 'application/json' }, body: raw });
  };
  assert.equal((await deliver({ action: 'deleted', installation: { id: 1001 } }, 'wrong')).status, 401);
  assert.equal((await deliver({ action: 'suspend', installation: { id: 1001 } })).status, 204);
  const suspended = await owner.db.from('github_installations').select('suspended_at').eq('workspace_id', workspaceId).single();
  assert.ok(suspended.data?.suspended_at);
  assert.equal((await deliver({ action: 'deleted', installation: { id: 1001 } })).status, 204);
  assert.equal((await owner.db.from('github_installations').select('installation_id').eq('workspace_id', workspaceId)).data?.length, 0);
});
