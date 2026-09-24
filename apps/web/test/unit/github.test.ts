import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHmac } from 'node:crypto';
import {
  appJwt, checkConclusion, checkSummary, createCheckRun, exchangeCode, githubConfig, installUrl, signState, userInstallations, verifyState, verifyWebhookSignature, type GitHubConfig,
} from '../../lib/github.ts';
import { slackMessage, validateSlackWebhook } from '../../lib/slack.ts';
// @ts-expect-error plain JS dev script without types
import { FAKE, startFakeServices } from '../../scripts/fake-services.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
let fake: { base: string; calls: Array<{ method: string; path: string; body: Record<string, unknown> }>; close: () => Promise<void> };
let config: GitHubConfig;

before(async () => {
  fake = await startFakeServices({ port: 0, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }), appUrl: 'http://app.test' });
  const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  config = githubConfig({
    GITHUB_APP_ID: FAKE.appId, GITHUB_APP_SLUG: FAKE.slug, GITHUB_APP_CLIENT_ID: FAKE.clientId, GITHUB_APP_CLIENT_SECRET: FAKE.clientSecret, GITHUB_APP_WEBHOOK_SECRET: FAKE.webhookSecret,
    // As a hosting dashboard stores it: one line with literal \n.
    GITHUB_APP_PRIVATE_KEY: pem.trim().replace(/\n/g, '\\n'),
    GITHUB_API_URL: `${fake.base}/api/`, GITHUB_URL: fake.base,
  }) as GitHubConfig;
});
after(() => fake.close());

test('config is absent until every app setting is there', () => {
  assert.equal(githubConfig({ GITHUB_APP_ID: '1' }), undefined);
  assert.ok(config.privateKey.startsWith('-----BEGIN PRIVATE KEY-----\n'));
  assert.equal(config.apiUrl, `${fake.base}/api`);
});

test('a check run is created with an installation token obtained with the app JWT', async () => {
  const check = await createCheckRun(config, 1001, { repository: 'acme-agency/flows', sha: 'a'.repeat(40), name: 'FlowRetest · Leads', conclusion: 'action_required', detailsUrl: 'http://app.test/runs/1', externalId: 'r1', title: 'DIFF', summary: 'plan' });
  assert.ok(check.id > 0);
  const posted = fake.calls.find((c) => c.path === '/api/repos/acme-agency/flows/check-runs');
  assert.equal(posted?.body.conclusion, 'action_required');
  assert.equal(posted?.body.status, 'completed');
  assert.equal(posted?.body.details_url, 'http://app.test/runs/1');
  await assert.rejects(createCheckRun(config, 1001, { repository: 'someone-else/flows', sha: 'a'.repeat(40), name: 'x', conclusion: 'success', detailsUrl: 'u', externalId: 'r', title: 't', summary: 's' }), /403/);
  const forged = { ...config, privateKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  await assert.rejects(createCheckRun(forged, 1001, { repository: 'acme-agency/flows', sha: 'a'.repeat(40), name: 'x', conclusion: 'success', detailsUrl: 'u', externalId: 'r', title: 't', summary: 's' }), /401/);
});

test('the app JWT lasts under ten minutes and is backdated for clock drift', () => {
  const [, body] = appJwt(config, 1_000_000).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(body as string, 'base64url').toString()), { iat: 999_940, exp: 1_000_540, iss: FAKE.appId });
});

test('an OAuth code gives a user token, and the token lists only that user\'s installations', async () => {
  const token = await exchangeCode(config, 'code-agency-dev');
  assert.deepEqual((await userInstallations(config, token)).map((i) => [i.id, i.account.login]), [[1001, 'acme-agency']]);
  await assert.rejects(exchangeCode(config, 'nonsense'), /refused the code/);
  await assert.rejects(exchangeCode({ ...config, clientSecret: 'wrong' }, 'code-agency-dev'), /refused the code/);
});

test('install state is signed, bound to its content and expires', () => {
  const state = signState('s3cret', { w: 'ws', u: 'user', e: 2_000 });
  assert.deepEqual(verifyState('s3cret', state, 1_000), { w: 'ws', u: 'user', e: 2_000 });
  assert.equal(verifyState('s3cret', state, 2_001), undefined, 'expired');
  assert.equal(verifyState('other', state, 1_000), undefined, 'other secret');
  const [body, sig] = state.split('.');
  const forged = Buffer.from(JSON.stringify({ w: 'victim-ws', u: 'user', e: 2_000 })).toString('base64url');
  assert.equal(verifyState('s3cret', `${forged}.${sig}`, 1_000), undefined, 'body swapped');
  assert.equal(verifyState('s3cret', `${body}`, 1_000), undefined);
  assert.equal(verifyState('s3cret', null, 1_000), undefined);
  assert.match(installUrl(config, state), new RegExp(`/apps/${FAKE.slug}/installations/new\\?state=`));
});

test('webhook signatures are checked on the raw body', () => {
  const raw = '{"action":"deleted"}';
  const sig = `sha256=${createHmac('sha256', 'hook').update(raw).digest('hex')}`;
  assert.equal(verifyWebhookSignature('hook', raw, sig), true);
  assert.equal(verifyWebhookSignature('hook', `${raw} `, sig), false);
  assert.equal(verifyWebhookSignature('hook', raw, null), false);
  assert.equal(verifyWebhookSignature('hook', raw, 'sha256=abcd'), false);
});

test('DIFF asks for review, ERROR and BLOCKED fail; long plans are cut under the GitHub limit', () => {
  assert.deepEqual(['PASS', 'DIFF', 'ERROR', 'BLOCKED'].map(checkConclusion), ['success', 'action_required', 'failure', 'failure']);
  const long = checkSummary('x'.repeat(100_000), 'http://app.test/runs/1');
  assert.ok(long.length <= 65_000);
  assert.ok(long.endsWith('(http://app.test/runs/1)'));
});

test('only Slack webhook URLs are accepted, and only a hint of the secret is kept', () => {
  const ok = validateSlackWebhook('https://hooks.slack.com/services/T0001/B0002/abcdefghijkl', '');
  assert.deepEqual(ok, { ok: true, url: 'https://hooks.slack.com/services/T0001/B0002/abcdefghijkl', hint: 'hooks.slack.com/services/T0001/B0002/abcd…' });
  for (const bad of ['http://hooks.slack.com/services/T/B/C', 'https://hooks.slack.com.evil.test/services/T/B/C', 'https://169.254.169.254/latest', 'https://hooks.slack.com/services/T/B/C?x=1', 'not a url']) {
    assert.equal(validateSlackWebhook(bad, '').ok, false, bad);
  }
  assert.equal(validateSlackWebhook('http://127.0.0.1:55390/slack/services/T/B/C', '127.0.0.1:55390').ok, true);
  const text = slackMessage({ status: 'DIFF', mode: 'change', workflowName: 'Leads <&>', workspaceName: 'Acme', summary: { cases: 1, PASS: 0, DIFF: 1, ERROR: 0, BLOCKED: 0, SKIPPED: 0, changed: 1, added: 0, removed: 0, blocked: 0 }, url: 'http://app.test/runs/1' }).text;
  assert.match(text, /Leads &lt;&amp;&gt;/);
  assert.match(text, /<http:\/\/app\.test\/runs\/1\|Open the plan>/);
});
