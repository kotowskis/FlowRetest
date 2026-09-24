import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildN8nEnv, toEnvFile } from '../src/sandbox/env.ts';
import { buildProbeWorkflow, extractLastJson, extractRun, parseWorkflowList, workflowId } from '../src/sandbox/probe-workflow.ts';

test('workflow ids are 16 alphanumerics and stable per seed', () => {
  const a = workflowId('frt/new/04');
  assert.match(a, /^[A-Za-z0-9]{15}\d$/);
  for (let i = 0; i < 50; i++) assert.match(workflowId(`frt/new/${i}`), /\d/);
  assert.equal(a, workflowId('frt/new/04'));
  assert.notEqual(a, workflowId('frt/old/04'));
  assert.equal((buildProbeWorkflow() as { id: string }).id.length, 16);
});

test('sandbox env points every process at the proxy and never leaks extras over sandbox keys', () => {
  const env = buildN8nEnv({ proxyHost: 'frt-1-proxy', proxyPort: 8080, timezone: 'Europe/Warsaw', extra: { HTTP_PROXY: 'http://evil', MY_FLAG: '1' } });
  assert.equal(env.HTTP_PROXY, 'http://frt-1-proxy:8080');
  assert.equal(env.HTTPS_PROXY, 'http://frt-1-proxy:8080');
  assert.equal(env.NO_PROXY, '127.0.0.1,localhost');
  assert.equal(env.MY_FLAG, '1');
  assert.equal(env.N8N_SSRF_PROTECTION_ENABLED, 'false');
  assert.equal(env.GENERIC_TIMEZONE, 'Europe/Warsaw');
  assert.match(env.N8N_ENCRYPTION_KEY ?? '', /^[0-9a-f]{48}$/);
  // n8n 2.41+ needs a seeded data key for import:credentials unless key rotation is off
  assert.equal(env.N8N_ENV_FEAT_ENCRYPTION_KEY_ROTATION, 'false');
  assert.equal(env.N8N_LOG_OUTPUT, 'file');
});

test('env file format is one KEY=value per line', () => {
  const text = toEnvFile({ A: '1', B: 'x=y' });
  assert.equal(text, 'A=1\nB=x=y\n');
  assert.throws(() => toEnvFile({ A: 'a\nb' }));
});

test('probe workflow has a manual trigger wired to one HTTPS GET', () => {
  const wf = buildProbeWorkflow() as { nodes: Array<{ type: string; name: string }>; connections: Record<string, unknown> };
  assert.deepEqual(wf.nodes.map((n) => n.type), ['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.httpRequest']);
  assert.ok('frt:start' in wf.connections);
});

test('list:workflow output is parsed into id and name', () => {
  const rows = parseWorkflowList('id|name\nAbC123|frt/doctor/probe\n  xyz | Other workflow \n');
  assert.deepEqual(rows, [
    { id: 'AbC123', name: 'frt/doctor/probe' },
    { id: 'xyz', name: 'Other workflow' },
  ]);
});

test('JSON log lines are unwrapped: list output and the execute run object', () => {
  const stdout = [
    'Trusting custom certificates from /opt/custom-certificates.',
    JSON.stringify({ level: 'info', message: 'n8n Task Broker ready on 127.0.0.1, port 5679' }),
    JSON.stringify({ level: 'info', message: 'frtdoctorprobe01|frt/doctor/probe' }),
    JSON.stringify({ level: 'info', message: JSON.stringify({ data: { resultData: { runData: {} } }, mode: 'cli', status: 'success' }, null, 2) }),
  ].join('\n');
  assert.deepEqual(parseWorkflowList(stdout), [{ id: 'frtdoctorprobe01', name: 'frt/doctor/probe' }]);
  const run = extractRun(stdout);
  assert.equal(run.mode, 'cli');
  assert.equal(run.status, 'success');
});

test('extractLastJson tolerates log lines before the JSON', () => {
  assert.deepEqual(extractLastJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractLastJson('info: starting\n{"x":{"y":[1,2]}}\n'), { x: { y: [1, 2] } });
  assert.throws(() => extractLastJson('nothing here'));
});
