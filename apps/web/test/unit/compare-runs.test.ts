import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { compareRuns } from '../../lib/compare-runs.ts';

const rec = (version: string, path: string, body: unknown): CaptureRecord => ({ ts: 1, version, case: '1', method: 'POST', host: 'crm.example.com', port: 443, path, query: {}, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } });
const call = (version: string, path: string, body: unknown) => normalizeCall(rec(version, path, body), { node: 'Push', runIndex: 0 });

function run(cases: PlanReport['cases']): PlanReport {
  return redactPlanReport({ runner: '0.3.0', workflowName: 'w', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'o', newLabel: 'n', cases, coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true });
}

test('two runs: a case that changed outcome lists its calls, an identical case is marked same, a new case has no earlier side', () => {
  const earlier = run([
    diffCase('1', [call('old', '/contacts', { a: 1 })], [call('new', '/contacts', { a: 2 })]),
    diffCase('2', [call('old', '/notes', { t: 'x' })], [call('new', '/notes', { t: 'x' })]),
  ]);
  const later = run([
    diffCase('1', [call('old', '/contacts', { a: 1 })], [call('new', '/contacts', { a: 1 }), call('new', '/tasks', { t: 'y' })]),
    diffCase('2', [call('old', '/notes', { t: 'x' })], [call('new', '/notes', { t: 'x' })]),
    diffCase('3', [], [call('new', '/deals', { d: 1 })]),
  ]);
  const result = compareRuns(earlier, later);
  assert.deepEqual(result.map((c) => [c.caseId, c.same]), [['1', false], ['2', true], ['3', false]]);
  const one = result[0]!;
  assert.deepEqual([one.before?.status, one.after?.status], ['DIFF', 'DIFF']);
  // In the order of the later run's plan.
  assert.deepEqual(one.calls.map((k) => [k.call, k.before, k.after]), [
    ['Push · POST crm.example.com/tasks', undefined, '+'],
    ['Push · POST crm.example.com/contacts', '~', '='],
  ]);
  assert.equal(result[2]!.before, undefined);
  assert.deepEqual(compareRuns(later, later).map((c) => c.same), [true, true, true]);
});
