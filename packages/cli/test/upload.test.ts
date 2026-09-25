/** Week 9: `upload` sends only the redacted report, with the workspace token, and reports refusals. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, saveConfig, saveApiKey, loadSecret } from '../src/config.ts';
import { runUpload } from '../src/commands/upload.ts';

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'frt-upload-'));
  saveConfig(cwd, defaultConfig('http://localhost:5678', '2.40.5', 'UTC'));
  const runDir = join(cwd, '.flowretest', 'w1', 'runs', '20260924-100000');
  mkdirSync(runDir, { recursive: true });
  const summary = { oldCalls: 1, newCalls: 1, unchanged: 0, changed: 1, added: 0, removed: 0, blocked: 0 };
  const call = (version: string, email: string) => ({ version, caseId: '1', node: 'Push', runIndex: 0, ts: 1, method: 'POST', host: 'crm.example.com', pathTemplate: '/contacts/{id}', path: '/contacts/4711', query: {}, body: { email }, bodyHash: 'abcdef0123456789', rule: { id: 'generic-sink', kind: 'generic-sink' }, blocked: false, key: 'Push|POST|crm.example.com|/contacts/{id}' });
  const entry = { op: '~', node: 'Push', method: 'POST', host: 'crm.example.com', pathTemplate: '/contacts/{id}', old: call('old', 'anna@firma.pl'), new: call('new', 'ANNA@firma.pl'), fieldDiffs: [{ path: 'email', old: 'anna@firma.pl', new: 'ANNA@firma.pl' }], flags: [] };
  writeFileSync(
    join(runDir, 'report.json'),
    JSON.stringify({ schemaVersion: 1, generatedAt: '2026-09-24T10:00:00.000Z', runner: '0.3.0', workflowId: 'w1', workflowName: 'Lead intake', engine: { image: 'n8nio/n8n:2.40.5' }, old: 'recorded', new: 'C:\\Users\\anna\\acme\\draft.json', status: 'DIFF', cases: [{ caseId: '1', status: 'DIFF', entries: [entry], summary }], calls: { '1': { old: [entry.old], new: [entry.new], volatile: [] } }, coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sandbox: { sealed: true, checks: [] } }),
  );
  return cwd;
}

async function server(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const address = srv.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((r) => srv.close(() => r())) };
}

test('upload posts the redacted report with the workspace token and returns the hosted URL', async () => {
  const cwd = project();
  const seen: { auth?: string; path?: string; body?: string } = {};
  const api = await server((req, body, res) => {
    Object.assign(seen, { auth: req.headers.authorization, path: req.url, body });
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'r1', url: 'https://app.example/runs/r1', status: 'DIFF' }));
  });
  process.env.FLOWRETEST_TOKEN = 'frt_test';
  try {
    const result = await runUpload({ cwd, workflowId: 'w1', url: api.url + '/', log: () => {} });
    assert.equal(result.url, 'https://app.example/runs/r1');
    assert.equal(seen.path, '/api/runs');
    assert.equal(seen.auth, 'Bearer frt_test');
    assert.ok(!seen.body?.includes('anna'), seen.body);
    assert.ok(!seen.body?.includes('4711'), 'concrete path ids stay local');
    assert.ok(!seen.body?.includes('Users'), 'local file paths in labels stay local');
    const sent = JSON.parse(seen.body ?? '{}') as { redacted: boolean; run: string; newLabel: string; calls?: unknown };
    assert.equal(sent.redacted, true);
    assert.equal(sent.run, '20260924-100000');
    assert.equal(sent.newLabel, 'draft.json');
    assert.equal(sent.calls, undefined, 'call registers are never uploaded');
  } finally {
    delete process.env.FLOWRETEST_TOKEN;
    await api.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a refused upload says why; a missing token or URL fails before any request', async () => {
  const cwd = project();
  const api = await server((_req, _body, res) => res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid token' })));
  try {
    await assert.rejects(runUpload({ cwd, workflowId: 'w1', url: api.url, log: () => {} }), /no workspace token/);
    process.env.FLOWRETEST_TOKEN = 'frt_bad';
    await assert.rejects(runUpload({ cwd, workflowId: 'w1', log: () => {} }), /no hosted layer URL/);
    await assert.rejects(runUpload({ cwd, workflowId: 'w1', url: api.url, log: () => {} }), /refused with 401 \(the token is wrong or revoked\): invalid token/);
  } finally {
    delete process.env.FLOWRETEST_TOKEN;
    await api.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the token can live in secrets.env next to the API key, and init keeps it', () => {
  const cwd = project();
  try {
    writeFileSync(join(cwd, '.flowretest', 'secrets.env'), 'FLOWRETEST_TOKEN=frt_file\n');
    saveApiKey(cwd, 'n8n-key');
    assert.equal(loadSecret(cwd, 'FLOWRETEST_TOKEN'), 'frt_file');
    assert.equal(loadSecret(cwd, 'FLOWRETEST_API_KEY'), 'n8n-key');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('in GitHub Actions the upload names the pull request head commit, not the merge commit', async () => {
  const { gitContext } = await import('../src/git-context.ts');
  const dir = mkdtempSync(join(tmpdir(), 'frt-git-'));
  try {
    const event = join(dir, 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { number: 12, head: { sha: 'a'.repeat(40) } } }));
    assert.deepEqual(gitContext({ GITHUB_REPOSITORY: 'acme/flows', GITHUB_SHA: 'b'.repeat(40), GITHUB_EVENT_PATH: event, GITHUB_HEAD_REF: 'fix-crm' }), { repository: 'acme/flows', sha: 'a'.repeat(40), pullRequest: 12, ref: 'fix-crm' });
    assert.deepEqual(gitContext({ GITHUB_REPOSITORY: 'acme/flows', GITHUB_SHA: 'b'.repeat(40) }), { repository: 'acme/flows', sha: 'b'.repeat(40) });
    assert.equal(gitContext({ FLOWRETEST_GIT_REPOSITORY: 'acme/flows', FLOWRETEST_GIT_SHA: 'b'.repeat(40), GITHUB_SHA: 'c'.repeat(40) })?.sha, 'b'.repeat(40));
    assert.equal(gitContext({}), undefined);
    assert.equal(gitContext({ GITHUB_REPOSITORY: 'not a repo', GITHUB_SHA: 'b'.repeat(40) }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a connection closed while sending the report is reported as a refused token when the server says so', async () => {
  const cwd = project();
  const srv = createServer((req, res) => {
    if (req.method === 'POST') {
      // Like a server that answers 401 before reading the body: here it drops the connection outright.
      req.socket.destroy();
      return;
    }
    assert.equal(req.url, '/api/acceptances?workflow=-');
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid or revoked workspace token' }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  process.env.FLOWRETEST_TOKEN = 'frt_revoked';
  try {
    await assert.rejects(runUpload({ cwd, workflowId: 'w1', url, log: () => {} }), (e: Error & { status?: number }) => e.status === 401 && /token is wrong or revoked/.test(e.message));
  } finally {
    delete process.env.FLOWRETEST_TOKEN;
    await new Promise<void>((r) => srv.close(() => r()));
    rmSync(cwd, { recursive: true, force: true });
  }
});
