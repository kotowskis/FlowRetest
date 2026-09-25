import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { MAX_REPORT_BYTES, prepareIngest } from '../../lib/ingest.ts';
import { bearerToken, generateToken, hashToken } from '../../lib/tokens.ts';
import { safeNext } from '../../lib/paths.ts';

function record(version: string, email: string): CaptureRecord {
  return { ts: 1, version, case: '41', method: 'POST', host: 'crm.example.com', port: 443, path: '/contacts/4711', query: {}, headers: {}, bodyJson: { email, score: 7 }, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
}

function plan(): PlanReport {
  const d = diffCase('41', [normalizeCall(record('old', 'anna@firma.pl'), { node: 'Push', runIndex: 0 })], [normalizeCall(record('new', ''), { node: 'Push', runIndex: 0 })]);
  return { runner: '0.3.0', workflowName: 'Lead intake', workflowId: 'wf1', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
}

function body(report: PlanReport, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 1, generatedAt: '2026-09-24T10:00:00Z', redacted: true, run: '2026-09-24T10-00-00', ...report, ...extra });
}

test('a redacted report becomes a row; the status comes from the cases, not from the client', () => {
  const result = prepareIngest(body(redactPlanReport(plan()), { status: 'PASS' }));
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.row.p_status, 'DIFF');
  assert.equal(result.row.p_mode, 'change');
  assert.equal(result.row.p_local_run, '2026-09-24T10-00-00');
  assert.deepEqual({ cases: result.row.p_summary.cases, DIFF: result.row.p_summary.DIFF, changed: result.row.p_summary.changed }, { cases: 1, DIFF: 1, changed: 1 });
  assert.equal(result.row.p_generated_at, '2026-09-24T10:00:00.000Z');
});

test('the raw report, a report with values and oversized or broken bodies are refused with the right status', () => {
  const raw = prepareIngest(body(plan()));
  assert.equal(raw.ok, false);
  assert.equal(!raw.ok && raw.status, 422);
  assert.ok(!raw.ok && raw.details?.some((d) => d.includes('body.email')));

  const notRedacted = prepareIngest(body(redactPlanReport(plan()), { redacted: false }));
  assert.equal(!notRedacted.ok && notRedacted.status, 400);
  assert.equal(!prepareIngest('{').ok && (prepareIngest('{') as { status: number }).status, 400);
  const big = prepareIngest('x'.repeat(MAX_REPORT_BYTES + 1));
  assert.equal(!big.ok && big.status, 413);
});

test('upgrade reports are stored as upgrade runs', () => {
  const result = prepareIngest(body(redactPlanReport({ ...plan(), upgrade: { engineOld: 'n8nio/n8n:2.40.5', engineNew: 'n8nio/n8n:3.0.0' } })));
  assert.ok(result.ok);
  assert.equal(result.row.p_mode, 'upgrade');
});

test('tokens: 32 random bytes, stored as SHA-256, parsed only from a well-formed bearer header', () => {
  const t = generateToken();
  assert.match(t.token, /^frt_[A-Za-z0-9_-]{43}$/);
  assert.equal(t.hash, hashToken(t.token));
  assert.match(t.hash, /^[0-9a-f]{64}$/);
  assert.equal(t.prefix, t.token.slice(0, 8));
  assert.notEqual(generateToken().token, t.token);
  assert.equal(bearerToken(`Bearer ${t.token}`), t.token);
  assert.equal(bearerToken(`bearer  ${t.token} `), t.token);
  assert.equal(bearerToken(t.token), undefined);
  assert.equal(bearerToken('Bearer frt_short'), undefined);
  assert.equal(bearerToken(null), undefined);
});

test('the post-login target is always a local path', () => {
  assert.equal(safeNext('/w/1'), '/w/1');
  assert.equal(safeNext('/runs/1?tab=plan#case-2'), '/runs/1?tab=plan#case-2');
  // Browsers drop tabs and newlines in URLs and read a backslash as a slash, so these lead to evil.example.
  for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/\t\\evil.example', 'https://evil.example', '', null, 42]) {
    assert.equal(safeNext(bad), '/orgs', JSON.stringify(bad));
  }
});
