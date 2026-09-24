/** Plan items closed after the audit (ADR 0006): engine differences, expectations, static findings in the plan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineDifferences } from '../src/engine.ts';
import { checkExpectations, type Expectation } from '../src/expect.ts';
import { diffCase, withExpectations } from '../src/diff.ts';
import { normalizeCall } from '../src/normalize.ts';
import { renderPlan, type PlanReport } from '../src/render.ts';
import { renderFormat } from '../src/render-formats.ts';
import type { CaptureRecord } from '../src/capture.ts';

const items = (...jsons: object[]) => jsons.map((json) => ({ json }));

test('engine differences: nodes on one engine only, run and item counts, output keys, new errors', () => {
  const old = {
    Webhook: [{ data: { main: [items({ a: 1 })] } }],
    Map: [{ data: { main: [items({ id: 1, name: 'x' }, { id: 2, name: 'y' })] } }],
    Gone: [{ data: { main: [items({})] } }],
    Push: [{ data: { main: [items({ ok: true })] } }],
  };
  const now = {
    Webhook: [{ data: { main: [items({ a: 1 })] } }],
    Map: [{ data: { main: [items({ id: 1, fullName: 'x' })] } }],
    Added: [{ data: { main: [items({})] } }],
    Push: [{ data: { main: [items({ ok: true })] } }, { data: { main: [items({ ok: true })] } }],
  };
  (now.Push[0] as { error?: { message: string } }).error = { message: 'boom' };
  const diffs = engineDifferences(old, now);
  assert.ok(diffs.includes('"Gone" ran on the old engine only'));
  assert.ok(diffs.includes('"Added" ran on the new engine only'));
  assert.ok(diffs.includes('"Map" output 0: 2 items -> 1'));
  assert.ok(diffs.includes('"Map" output 0: new keys fullName; "Map" output 0: missing keys name'));
  assert.ok(diffs.includes('"Push" ran 1 time on the old engine, 2 on the new one'));
  assert.ok(diffs.includes('"Push" fails on the new engine: boom'));
  assert.ok(!diffs.some((d) => d.includes('Webhook')));
  assert.deepEqual(engineDifferences(old, old), []);
});

function call(body: unknown, node = 'Push to ERP', ts = 1, query: Record<string, string> = {}) {
  const record: CaptureRecord = { ts, version: 'new', case: '7', method: 'POST', host: 'erp.example.com', port: 443, path: '/api/orders', query, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
  return normalizeCall(record, { node, runIndex: 0 });
}

test('expectations catch what both versions get wrong', () => {
  const expectations: Expectation[] = [
    { node: 'Push to ERP', calls: 2, fields: { customer_id: 'notEmpty', email: { matches: '^[^@]+@[^@]+$' }, 'lines[*].sku': 'notEmpty', debug: 'absent', status: { oneOf: ['new', 'open'] }, '?dry_run': { equals: 'false' } } },
    { node: 'Slack', calls: { max: 0 } },
    { node: 'Push to ERP', cases: ['other'], calls: 99 },
  ];
  const good = [call({ customer_id: 'C-1', email: 'a@b.pl', lines: [{ sku: 'A' }], status: 'new' }, 'Push to ERP', 1, { dry_run: 'false' }), call({ customer_id: 'C-2', email: 'c@d.pl', lines: [{ sku: 'B' }], status: 'open' }, 'Push to ERP', 2, { dry_run: 'false' })];
  assert.deepEqual(checkExpectations(expectations, '7', good), []);

  const bad = [call({ customer_id: '', email: 'nope', lines: [{ sku: 'A' }, { sku: '' }], debug: true, status: 'closed' }), call({}, 'Slack')];
  const failures = checkExpectations(expectations, '7', bad);
  assert.deepEqual(failures, [
    '"Push to ERP" sent 1 call, expected 2',
    '"Push to ERP" call 1: customer_id is empty ("")',
    '"Push to ERP" call 1: email is "nope", expected to match /^[^@]+@[^@]+$/',
    '"Push to ERP" call 1: lines[*].sku is empty ("A", "")',
    '"Push to ERP" call 1: debug is present (true)',
    '"Push to ERP" call 1: status is "closed", expected one of "new", "open"',
    '"Push to ERP" call 1: ?dry_run is missing, expected "false"',
    '"Slack" sent 1 call, expected at most 0',
  ]);

  // Same calls in both versions: the diff says PASS, the expectation makes it DIFF and the plan says why.
  const d = withExpectations(diffCase('7', bad, bad), failures);
  assert.equal(d.status, 'DIFF');
  const report: PlanReport = { runner: '0', workflowName: 'w', engine: { image: 'i' }, oldLabel: 'o', newLabel: 'n', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
  assert.match(renderPlan(report), /^x \[7\] expectation: "Push to ERP" sent 1 call, expected 2$/m);
  assert.match(renderFormat(report, 'md'), /Expectation failed: "Slack" sent 1 call/);
  assert.match(renderFormat(report, 'junit'), /expectation: &quot;Push to ERP&quot; call 1: customer_id is empty/);
  assert.equal(withExpectations(diffCase('7', [], [], { newError: 'x' }), ['f']).status, 'ERROR');
});

test('the plan has an Engine differences section in upgrade-check and a line for static findings', () => {
  const d = { ...diffCase('7', [call({ a: 1 })], [call({ a: 1 })]), engineDifferences: ['"Map" output 0: 2 items -> 1'] };
  const report: PlanReport = {
    runner: '0', workflowName: 'w', engine: { image: 'i' }, oldLabel: 'o', newLabel: 'n', cases: [d],
    coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true,
    upgrade: { engineOld: '2.40.5', engineNew: '3.0.0' },
    static: { findings: [{ rule: 'S013', severity: 'warn', node: 'X', message: 'm' }, { rule: 'S000', severity: 'error', node: 'Y', message: 'm' }], diff: [{ rule: 'S009', severity: 'info', message: 'm' }] },
  };
  const text = renderPlan(report);
  assert.match(text, /^Engine differences \(2\.40\.5 -> 3\.0\.0\):\n {2}\[7\] "Map" output 0: 2 items -> 1\n {2}outbound calls are the same on both engines/m);
  assert.match(text, /^Static findings: 1 error, 1 warning \(run `flowretest scan` for details\)$/m);
  assert.match(renderFormat(report, 'md'), /### Engine differences \(2\.40\.5 -> 3\.0\.0\)/);
  assert.match(renderFormat(report, 'junit'), /<system-out>&quot;Map&quot; output 0: 2 items -&gt; 1<\/system-out>/);
  assert.doesNotMatch(renderPlan({ ...report, upgrade: undefined, static: undefined }), /Engine differences|Static findings/);
});
