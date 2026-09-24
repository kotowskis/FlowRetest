/** Week 10: `sync` writes baselines for acceptances made in the hosted layer, from the local report of the accepted run. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, saveConfig } from '../src/config.ts';
import { runSync } from '../src/commands/sync.ts';
import { runRedactReport } from '../src/commands/redact.ts';

const RUN = '2026-09-24T10-00-00';

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'frt-sync-'));
  saveConfig(cwd, defaultConfig('http://localhost:5678', '2.40.5', 'UTC'));
  const runDir = join(cwd, '.flowretest', 'w1', 'runs', RUN);
  mkdirSync(runDir, { recursive: true });
  const summary = { oldCalls: 1, newCalls: 1, unchanged: 0, changed: 1, added: 0, removed: 0, blocked: 0 };
  const call = { version: 'new', caseId: '1', node: 'Push', runIndex: 0, ts: 1, method: 'POST', host: 'crm.example.com', pathTemplate: '/contacts', path: '/contacts', query: {}, body: { email: 'ola@firma.pl' }, bodyHash: 'abcdef0123456789', rule: { id: 'generic-sink', kind: 'generic-sink' }, blocked: false, key: 'Push|POST|crm.example.com|/contacts' };
  const c = (id: string) => ({ caseId: id, status: 'DIFF', entries: [], summary });
  writeFileSync(
    join(runDir, 'report.json'),
    JSON.stringify({ schemaVersion: 1, generatedAt: '2026-09-24T10:00:00.000Z', runner: '0.3.0', workflowId: 'w1', workflowName: 'Lead intake', engine: { image: 'n8nio/n8n:2.40.5' }, old: 'recorded', new: 'draft.json', status: 'DIFF', cases: [c('1'), c('2')], calls: { '1': { old: [call], new: [{ ...call, caseId: '1' }], volatile: [], stable: true }, '2': { old: [call], new: [{ ...call, caseId: '2' }], volatile: [], stable: false } }, coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sandbox: { sealed: true, checks: [] } }),
  );
  return cwd;
}

async function server(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => new Promise((r) => srv.close(() => r())) };
}

test('sync writes baselines for acceptances whose run is here, reports refused cases and leaves the rest pending', async () => {
  const cwd = project();
  const applied: Array<{ path: string; body: { appliedCases: string[]; note?: string } }> = [];
  const acceptances = [
    { id: 'a1', localRun: RUN, caseIds: ['1', '2'], message: 'new CRM field', acceptedBy: 'anna@agency.test', createdAt: '2026-09-24T11:00:00Z' },
    { id: 'a2', localRun: '2026-09-20T09-00-00', caseIds: ['1'], message: null, acceptedBy: 'ci@agency.test', createdAt: '2026-09-24T12:00:00Z' },
  ];
  const api = await server((req, body, res) => {
    if (req.method === 'GET') {
      assert.equal(req.url, '/api/acceptances?workflow=w1');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ acceptances }));
      return;
    }
    applied.push({ path: req.url ?? '', body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"applied":true}');
  });
  process.env.FLOWRETEST_TOKEN = 'frt_test';
  try {
    const result = await runSync({ cwd, workflowId: 'w1', url: api.url, log: () => {} });
    assert.deepEqual(result.applied, [{ id: 'a1', cases: ['1'] }]);
    assert.deepEqual(result.pending, [{ id: 'a2', reason: 'run 2026-09-20T09-00-00 is not on this machine' }]);
    assert.equal(applied.length, 1);
    assert.equal(applied[0]?.path, '/api/acceptances/a1/applied');
    assert.deepEqual(applied[0]?.body.appliedCases, ['1']);
    assert.match(applied[0]?.body.note ?? '', /case 2: .*not accepted/);
    const baseline = JSON.parse(readFileSync(join(cwd, '.flowretest', 'w1', 'baseline', '1.json'), 'utf8')) as { acceptedBy: string; message: string };
    assert.equal(baseline.acceptedBy, 'anna@agency.test');
    assert.equal(baseline.message, 'new CRM field');
    assert.equal(existsSync(join(cwd, '.flowretest', 'w1', 'baseline', '2.json')), false, 'an unstable case got a baseline');
  } finally {
    delete process.env.FLOWRETEST_TOKEN;
    await api.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the redacted report tells the hosted layer which cases were proven stable', () => {
  const cwd = project();
  try {
    const file = runRedactReport({ cwd, workflowId: 'w1', log: () => {} });
    const redacted = JSON.parse(readFileSync(file, 'utf8')) as { stability: Record<string, boolean> };
    assert.deepEqual(redacted.stability, { '1': true, '2': false });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
