/** Week 9: what the hosted layer accepts. A redacted report passes the guard; the original does not. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactPlanReport, redactionProblems } from '../src/redact.ts';
import { normalizeCall } from '../src/normalize.ts';
import { diffCase } from '../src/diff.ts';
import type { CaptureRecord } from '../src/capture.ts';
import type { PlanReport } from '../src/render.ts';

function record(version: string, body: unknown, path = '/v1/sms'): CaptureRecord {
  return { ts: 1, version, case: '7', method: 'POST', host: 'api.sms.example', port: 443, path, query: { to: '601234567' }, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'abc', multipart: undefined, rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
}

function report(): PlanReport {
  const d = diffCase(
    '7',
    [normalizeCall(record('old', { phone: '601234567', amount: 10, tags: ['vip'] }, '/v1/contacts/1717171/sms'), { node: 'Send', runIndex: 0 })],
    [normalizeCall(record('new', { phone: '', amount: 12, tags: ['vip'] }, '/v1/contacts/1717171/sms'), { node: 'Send', runIndex: 0 })],
  );
  return { runner: '0', workflowName: 'w', workflowId: 'wf1', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'o', newLabel: 'n', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
}

test('a report straight from the run is refused, its redacted copy is accepted', () => {
  const plain = report();
  const problems = redactionProblems(plain);
  assert.ok(problems.some((p) => p.includes('body.phone')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('query.to')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('concrete path')), problems.join('\n'));
  assert.deepEqual(redactionProblems(redactPlanReport(plain)), []);
});

test('numbers and booleans stay in a redacted report, strings in field diffs must be shapes', () => {
  const red = redactPlanReport(report());
  const entry = red.cases[0]?.entries[0];
  assert.equal((entry?.new?.body as { amount: number }).amount, 12);
  const tampered: PlanReport = { ...red, cases: red.cases.map((c) => ({ ...c, entries: c.entries.map((e) => ({ ...e, fieldDiffs: [{ path: 'phone', old: '601234567', new: '<string 0 #00000000>' }] })) })) };
  assert.deepEqual(redactionProblems(tampered), ['case 7 entry 1 field phone (old): value is not redacted']);
});

test('the body hash in a redacted report is salted: equal inside one report, different across salts', () => {
  const plain = report();
  const a = redactPlanReport(plain, { salt: 'a' });
  const b = redactPlanReport(plain, { salt: 'b' });
  const hash = (r: PlanReport) => r.cases[0]?.entries[0]?.old?.bodyHash;
  assert.notEqual(hash(a), plain.cases[0]?.entries[0]?.old?.bodyHash);
  assert.notEqual(hash(a), hash(b));
  assert.equal(hash(a), hash(redactPlanReport(plain, { salt: 'a' })));
});
