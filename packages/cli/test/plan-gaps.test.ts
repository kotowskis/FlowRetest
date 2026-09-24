/** Plan items closed after the audit (ADR 0006): diff --format, sandbox export --compose, expectations.yml, colours. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { defaultConfig, saveConfig } from '../src/config.ts';
import { runDiff } from '../src/commands/diff.ts';
import { exportCompose, type SandboxManifest } from '../src/sandbox/compose.ts';
import { loadExpectations } from '../src/stubs.ts';
import { colorPlan } from '../src/color.ts';

function project(): { cwd: string; runDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'frt-gaps-'));
  saveConfig(cwd, defaultConfig('http://localhost:5678', '2.40.5', 'UTC'));
  const runDir = join(cwd, '.flowretest', 'w1', 'runs', '20260924-100000');
  mkdirSync(runDir, { recursive: true });
  const summary = { oldCalls: 1, newCalls: 1, unchanged: 1, changed: 0, added: 0, removed: 0, blocked: 0 };
  const call = { version: 'new', caseId: '1', node: 'Push', runIndex: 0, ts: 1, method: 'POST', host: 'erp.example.com', pathTemplate: '/api/orders', path: '/api/orders', query: {}, body: { customer_id: '' }, bodyHash: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, blocked: false, key: 'Push|POST|erp.example.com|/api/orders' };
  writeFileSync(
    join(runDir, 'report.json'),
    JSON.stringify({ schemaVersion: 1, generatedAt: 'x', runner: '0.3.0', workflowId: 'w1', workflowName: 'Lead intake', engine: { image: 'n8nio/n8n:2.40.5' }, old: 'recorded', new: 'draft.json', status: 'PASS', cases: [{ caseId: '1', status: 'PASS', entries: [], summary }], calls: { '1': { old: [call], new: [call], volatile: [] } }, coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sandbox: { sealed: true, checks: [] } }),
  );
  return { cwd, runDir };
}

test('diff --format writes JUnit and Markdown into the run directory, with separate names against baselines', () => {
  const { cwd, runDir } = project();
  try {
    const out = runDiff({ cwd, workflowId: 'w1', against: 'old', formats: ['junit', 'md'], log: () => {} });
    assert.deepEqual(out.files.map((f) => f.slice(runDir.length + 1)), ['junit.xml', 'plan.md']);
    assert.match(readFileSync(join(runDir, 'junit.xml'), 'utf8'), /<testcase classname="flowretest" name="case 1"\/>/);
    assert.match(readFileSync(join(runDir, 'plan.md'), 'utf8'), /Sandbox sealed \(checked before the run\)/);
    const baseline = runDiff({ cwd, workflowId: 'w1', against: 'baseline', formats: ['junit'], log: () => {} });
    assert.equal(baseline.files[0]?.slice(runDir.length + 1), 'junit.baseline.xml');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('expectations.yml is checked again by diff --against baseline and must match its schema', () => {
  const { cwd } = project();
  try {
    const dir = join(cwd, '.flowretest', 'w1');
    writeFileSync(join(dir, 'expectations.yml'), 'schemaVersion: 1\nexpect:\n  - node: Push\n    fields:\n      customer_id: notEmpty\n');
    assert.equal(loadExpectations(cwd, 'w1').length, 1);
    mkdirSync(join(dir, 'baseline'), { recursive: true });
    const call = { node: 'Push', runIndex: 0, method: 'POST', host: 'erp.example.com', pathTemplate: '/api/orders', path: '/api/orders', query: {}, body: { customer_id: '' }, bodyHash: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, blocked: false, key: 'Push|POST|erp.example.com|/api/orders' };
    writeFileSync(join(dir, 'baseline', '1.json'), JSON.stringify({ schemaVersion: 1, caseId: '1', acceptedAt: 'x', runnerVersion: '0', volatilePaths: [], calls: [call] }));
    const out = runDiff({ cwd, workflowId: 'w1', against: 'baseline', log: () => {} });
    assert.equal(out.cases[0]?.status, 'DIFF');
    assert.deepEqual(out.cases[0]?.expectationFailures, ['"Push" call 1: customer_id is empty ("")']);
    writeFileSync(join(dir, 'expectations.yml'), 'schemaVersion: 1\nexpect:\n  - node: Push\n    fields:\n      customer_id: nonEmpty\n');
    assert.throws(() => loadExpectations(cwd, 'w1'), /expectations\.yml/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('sandbox export writes a compose file that keeps n8n on the internal network', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frt-export-'));
  try {
    const manifest: SandboxManifest = {
      schemaVersion: 1, id: 'abcd1234', network: 'frt-abcd1234', volume: 'frt-abcd1234-n8n', proxyName: 'frt-abcd1234-proxy', n8nImage: 'n8nio/n8n:2.40.5', proxyImage: 'flowretest-proxy:dev',
      dirs: { rules: join(dir, 'rules'), capture: join(dir, 'capture'), certs: join(dir, 'certs'), work: join(dir, 'work'), out: join(dir, 'out') }, envFile: join(dir, 'n8n.env'), caDir: join(dir, 'ca'), createdAt: 'x',
    };
    writeFileSync(join(dir, 'sandbox.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'n8n.env'), 'HTTP_PROXY=http://frt-abcd1234-proxy:8080\n');
    for (const d of Object.values(manifest.dirs)) mkdirSync(d, { recursive: true });
    const file = exportCompose(dir);
    const compose = parse(readFileSync(file, 'utf8')) as { services: Record<string, { networks: unknown; ports?: string[] }>; networks: Record<string, { internal?: boolean }> };
    assert.equal(compose.networks.sandbox?.internal, true);
    assert.deepEqual(compose.services.n8n?.networks, ['sandbox']);
    assert.deepEqual(compose.services.proxy?.networks, { sandbox: { aliases: ['frt-abcd1234-proxy'] } });
    assert.deepEqual(compose.services.editor?.ports, ['127.0.0.1:5678:5678']);
    // Docker Compose itself must accept the file, when it is installed.
    const check = spawnSync('docker', ['compose', '-f', file, 'config', '--quiet'], { encoding: 'utf8' });
    if (check.status !== null && !/not a docker command|unknown/i.test(check.stderr)) assert.equal(check.status, 0, check.stderr);
    assert.throws(() => exportCompose(join(dir, 'missing')), /sandbox\.json/);
    assert.ok(existsSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('colours follow the line prefix and stay off when disabled', () => {
  const text = '~ [1] Push POST x\n+ [1] Slack\nResult: DIFF (exit code 1)';
  assert.equal(colorPlan(text, false), text);
  const coloured = colorPlan(text, true);
  assert.notEqual(coloured, text);
  // eslint-disable-next-line no-control-regex -- stripping ANSI codes
  assert.equal(coloured.replace(/\u001b\[[0-9;]*m/g, ''), text);
});
