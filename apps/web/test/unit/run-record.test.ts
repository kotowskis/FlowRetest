import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { recordCases, recordFileName } from '../../lib/run-record.ts';
import { renderRunRecord, type RunRecordInput } from '../../lib/pdf/run-record-pdf.ts';
import { compareEngineTags, engineTag, latestPerTag } from '../../lib/plans.ts';

function rec(version: string, method: string, path: string, body: unknown): CaptureRecord {
  return { ts: 1, version, case: '1', method, host: 'crm.example.com', port: 443, path, query: {}, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
}

/** Case 1: one changed call (email and a new field), one unchanged; case 2: a new call. Redacted like an upload. */
function report(): PlanReport {
  const node = 'Wyślij do CRM (żółty)';
  const c1 = diffCase(
    '1',
    [normalizeCall(rec('old', 'POST', '/contacts', { email: 'anna@firma.pl', tags: ['lead'] }), { node, runIndex: 0 }), normalizeCall(rec('old', 'GET', '/owners', undefined), { node: 'Owner', runIndex: 0 })],
    [normalizeCall(rec('new', 'POST', '/contacts', { email: 'ola@firma.pl', tags: ['lead'], source: 'form' }), { node, runIndex: 0 }), normalizeCall(rec('new', 'GET', '/owners', undefined), { node: 'Owner', runIndex: 0 })],
  );
  const c2 = diffCase('2', [], [normalizeCall(rec('new', 'POST', '/notes', { text: 'hello' }), { node: 'Note', runIndex: 0 })]);
  return redactPlanReport({ runner: '0.3.0', workflowName: 'Lead intake', workflowId: 'wf1', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [c2, c1], coverage: { writeNodesTotal: 2, writeNodesCaptured: 2, replayedNodes: 1, unsupported: [] }, sealed: true });
}

test('the record lists every call the new version sends, with shapes and the old value of changed fields', () => {
  const cases = recordCases(report());
  // Equal statuses keep the report's order (case 2 came first).
  assert.deepEqual(cases.map((c) => [c.caseId, c.status]), [['2', 'DIFF'], ['1', 'DIFF']]);
  const changed = cases[1]!.calls.find((c) => c.op === '~')!;
  assert.equal(changed.node, 'Wyślij do CRM (żółty)');
  assert.equal(changed.request, 'POST crm.example.com/contacts');
  assert.equal(changed.fields[0]!.path, '@path', 'request line first');
  const email = changed.fields.find((f) => f.path === 'email')!;
  assert.equal(email.changed, true);
  assert.match(email.sent, /^<string 12 #[0-9a-f]+>$/, 'a shape, not the address');
  assert.match(email.before ?? '', /^<string 13 #[0-9a-f]+>$/);
  assert.equal(changed.fields.find((f) => f.path === 'source')?.before, '(absent)');
  assert.equal(changed.fields.find((f) => f.path === 'tags[0]')?.changed, false);
  assert.ok(cases[1]!.calls.some((c) => c.op === '='), 'unchanged calls are part of the record');
  assert.equal(cases[0]!.calls[0]!.op, '+');
  const json = JSON.stringify(cases);
  assert.ok(!json.includes('firma.pl') && !json.includes('hello'), 'no value reaches the record');
  assert.equal(recordCases(report(), { fields: 2, rows: 400 })[1]!.calls.find((c) => c.op === '~')!.more > 0, true);
});

test('changed fields survive the per-call limit, and the document stops at its row budget', () => {
  // 200 body fields, only the last one changed: the limit must not cut it.
  const wide = (v: string) => Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`f${i}`, i === 199 ? v : 'same']));
  const one = redactPlanReport({ ...report(), cases: [diffCase('1', [normalizeCall(rec('old', 'POST', '/wide', wide('a')), { node: 'N', runIndex: 0 })], [normalizeCall(rec('new', 'POST', '/wide', wide('b')), { node: 'N', runIndex: 0 })])] });
  const call = recordCases(one)[0]!.calls[0]!;
  assert.equal(call.fields.length, 150);
  assert.equal(call.fields.find((f) => f.path === 'f199')?.changed, true);
  assert.equal(call.more, 51, '200 body fields and @path, 150 shown');
  assert.ok(call.fields.findIndex((f) => f.path === 'f199') > call.fields.findIndex((f) => f.path === 'f0'), 'request order kept');

  const many = { cases: Array.from({ length: 30 }, (_, i) => ({ ...one.cases[0]!, caseId: String(i + 1) })) };
  const cases = recordCases(many, { fields: 150, rows: 400 });
  const rows = cases.reduce((n, c) => n + c.calls.reduce((m, k) => m + 1 + k.fields.length, 0), 0);
  assert.ok(rows <= 400, `${rows} rows`);
  assert.equal(cases.reduce((n, c) => n + c.calls.length + c.moreCalls, 0), 30, 'every call is either shown or counted');
});

test('file names are ASCII slugs with the date and status', () => {
  assert.equal(recordFileName('Wyślij leady: Łódź / CRM', 'DIFF', '2026-09-25T10:00:00Z'), 'flowretest-wyslij-leady-lodz-crm-2026-09-25-diff.pdf');
  assert.equal(recordFileName('???', 'PASS', '2026-09-25'), 'flowretest-workflow-2026-09-25-pass.pdf');
});

test('the PDF renders with Polish node names and many pages', async () => {
  const r = report();
  // Enough cases for several pages, so the fixed footer and page breaks are exercised.
  const cases = recordCases({ cases: Array.from({ length: 12 }, (_, i) => ({ ...r.cases[1]!, caseId: String(i + 1) })) });
  const input: RunRecordInput = {
    runId: '00000000-0000-4000-8000-000000000001', runUrl: 'http://127.0.0.1:3100/runs/00000000-0000-4000-8000-000000000001', status: 'DIFF', mode: 'change', workflowName: 'Wyślij leady (Łódź)',
    n8nWorkflowId: 'wf1', workspaceName: 'Klient Żuraw', organizationName: 'Agencja', oldLabel: 'recorded', newLabel: 'draft.json', engineImage: 'n8nio/n8n:2.40.5', runner: '0.3.0',
    generatedAt: '2026-09-25 10:00 UTC', uploadedAt: '2026-09-25 10:01 UTC', sealed: true, localRun: '2026-09-25T10-00-00', commit: { repository: 'acme/flows', sha: 'c'.repeat(40), pullRequest: 7 },
    coverage: r.coverage, summary: { cases: 12, DIFF: 12, changed: 12, added: 0, removed: 0, blocked: 0 },
    acceptances: [{ acceptedBy: 'owner@agency.test', at: '2026-09-25 11:00 UTC', cases: ['1'], message: 'Nowe pole źródła, uzgodnione z klientem', appliedAt: null }],
    cases, printedAt: '2026-09-25 12:00 UTC',
  };
  const pdf = await renderRunRecord(input);
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(pdf.length > 20_000, `${pdf.length} bytes`);
  if (process.env.RUN_RECORD_OUT) writeFileSync(process.env.RUN_RECORD_OUT, pdf);
});

test('engine tags: numeric versions newest first, named tags after them', () => {
  assert.equal(engineTag('n8nio/n8n:2.41.0'), '2.41.0');
  assert.equal(engineTag('registry.local:5000/n8nio/n8n:next'), 'next');
  assert.equal(engineTag('n8nio/n8n'), 'latest', 'Docker reads a missing tag as latest');
  assert.equal(engineTag('n8nio/n8n@sha256:0123456789abcdef0123'), '@0123456789ab');
  assert.equal(engineTag('n8nio/n8n:2.41.0@sha256:0123456789abcdef'), '2.41.0');
  assert.deepEqual(['next', '2.40.5', '2.41.0', 'v3-nightly', '2.9.1'].sort(compareEngineTags), ['2.41.0', '2.40.5', '2.9.1', 'next', 'v3-nightly']);
});

test('the matrix keeps one cell per workflow and tag: the newest run, whatever registry it named', () => {
  const cell = (id: string, image: string, at: string) => ({ id, workflow_id: 'w1', engine_to: image, created_at: at });
  const cells = latestPerTag([
    cell('b', 'docker.n8n.io/n8nio/n8n:2.41.0', '2026-09-25T10:00:00Z'),
    cell('a', 'n8nio/n8n:2.41.0', '2026-09-25T09:00:00Z'),
    cell('c', 'n8nio/n8n:next', '2026-09-25T08:00:00Z'),
    cell('d', 'n8nio/n8n:next', '2026-09-25T08:00:00Z'),
  ]);
  assert.deepEqual(cells.map((c) => c.id).sort(), ['b', 'd']);
});
