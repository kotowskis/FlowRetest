import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputCounts, type CaptureRecord } from '../src/capture.ts';
import { normalizeCall } from '../src/normalize.ts';
import { diffCase } from '../src/diff.ts';
import { detectVolatile, fromBaseline, maskVolatile, runsIdentical, toBaseline } from '../src/baseline.ts';

function call(version: string, body: unknown, node = 'Push', ts = 1): ReturnType<typeof normalizeCall> {
  const record: CaptureRecord = { ts, version, case: 'c', method: 'POST', host: 'h', port: 443, path: '/p', query: {}, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
  return normalizeCall(record, { node, runIndex: 0 });
}

test('volatile paths are detected between two runs and masked away', () => {
  const a = [call('old', { email: 'a', nonce: 'x1', meta: { trace: 't1' } })];
  const b = [call('old2', { email: 'a', nonce: 'x2', meta: { trace: 't2' } })];
  const paths = detectVolatile(a, b);
  assert.deepEqual(paths, ['Push|POST|h|/p :: meta.trace', 'Push|POST|h|/p :: nonce']);
  assert.ok(!runsIdentical(a, b));
  assert.ok(runsIdentical(maskVolatile(a, paths), maskVolatile(b, paths)));
  assert.equal((maskVolatile(a, paths)[0]?.body as { nonce: string }).nonce, '<volatile>');
});

test('baseline round-trips and compares', () => {
  const calls = [call('new', { email: 'a' }), call('new', { email: 'b' }, 'Push', 2)];
  const baseline = toBaseline('c', calls, { acceptedAt: '2026-09-24T00:00:00Z', runnerVersion: '0.0.0' });
  assert.equal(baseline.calls.length, 2);
  assert.ok(!('ts' in (baseline.calls[0] as object)));
  assert.equal(diffCase('c', fromBaseline(baseline), calls).status, 'PASS');
  assert.equal(diffCase('c', fromBaseline(baseline), [call('new', { email: 'z' })]).status, 'DIFF');
});

test('input counts follow the previous node output and flags fire on ratio change', () => {
  const runData = {
    Webhook: [{ startTime: 1, executionTime: 1, data: { main: [[{}, {}]] } }],
    Push: [{ startTime: 2, executionTime: 1, source: [{ previousNode: 'Webhook' }], data: { main: [[{}]] } }],
  };
  assert.deepEqual(inputCounts(runData), { Webhook: 0, Push: 2 });
  const oldCalls = [call('old', { e: 'a' }), call('old', { e: 'b' }, 'Push', 2)];
  const newCalls = [call('new', { e: 'a' })];
  const d = diffCase('c', oldCalls, newCalls, { oldInputCounts: { Push: 2 }, newInputCounts: { Push: 2 }, oldNodesRun: ['Push'], newNodesRun: ['Push'] });
  const removed = d.entries.find((e) => e.op === '-');
  assert.ok(removed?.flags.includes('count-changed'));
  assert.ok(removed?.flags.includes('count-per-item-changed'));
  const gone = diffCase('c', oldCalls, [], { oldNodesRun: ['Push'], newNodesRun: [] });
  assert.ok(gone.entries.every((e) => e.flags.includes('node-not-executed')));
});
