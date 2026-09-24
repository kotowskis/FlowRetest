import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeRecord, runWindows, type CaptureRecord } from '../src/capture.ts';
import { normalizeCall } from '../src/normalize.ts';
import { diffCase } from '../src/diff.ts';
import { classify } from '../src/classify.ts';
import { rewriteWorkflow, NODE_TAG_HEADER } from '../src/rewrite.ts';
import { scanWorkflow } from '../src/scan.ts';
import type { Fixture } from '../src/fixture.ts';
import type { N8nWorkflow } from '../src/n8n.ts';

function record(over: Partial<CaptureRecord>): CaptureRecord {
  return { ts: 1000, version: 'new', case: 'c', method: 'POST', host: 'h', port: 443, path: '/p', query: {}, headers: {}, bodyJson: { a: 1 }, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 }, ...over };
}

test('query parameters take part in the diff', () => {
  const oldCall = normalizeCall(record({ version: 'old', query: { dry_run: 'true' } }), { node: 'Push', runIndex: 0 });
  const newCall = normalizeCall(record({ version: 'new' }), { node: 'Push', runIndex: 0 });
  const d = diffCase('c', [oldCall], [newCall]);
  assert.equal(d.status, 'DIFF');
  const e = d.entries[0];
  assert.equal(e?.op, '~');
  assert.deepEqual(e?.fieldDiffs, [{ path: '?dry_run', old: 'true', new: undefined }]);
  assert.ok(e?.flags.includes('missing-field'));
});

test('the node tag header wins over timing and keeps the run index when the window matches', () => {
  const windows = runWindows({ Push: [{ startTime: 100, executionTime: 50 }], Loop: [{ startTime: 150, executionTime: 5 }] });
  assert.deepEqual(attributeRecord({ ts: 152, headers: { 'x-flowretest-node': 'Push' } }, windows), { node: 'Push', runIndex: 0 });
  assert.deepEqual(attributeRecord({ ts: 152, headers: {} }, windows), { node: 'Loop', runIndex: 0 });
  assert.deepEqual(attributeRecord({ ts: 900, headers: { 'x-flowretest-node': 'Other' } }, windows), { node: 'Other', runIndex: -1 });
});

test('rewriter tags HTTP Request write nodes and leaves JSON-specified headers alone', () => {
  const wf: N8nWorkflow = {
    name: 'tag',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { method: 'POST', url: 'https://erp.example.com/x', sendHeaders: true, specifyHeaders: 'keypair', headerParameters: { parameters: [{ name: 'X-Team', value: 'ops' }] } }, name: 'Push', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [300, 0] },
      { parameters: { method: 'POST', url: 'https://erp.example.com/y', sendHeaders: true, specifyHeaders: 'json', jsonHeaders: '{"a":"b"}' }, name: 'Raw', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [600, 0] },
    ],
    connections: { Webhook: { main: [[{ node: 'Push', type: 'main', index: 0 }, { node: 'Raw', type: 'main', index: 0 }]] } },
  };
  const fixture: Fixture = { schemaVersion: 1, source: { workflowId: 'w', executionId: '1' }, trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: {} }] }, nodes: {}, redacted: false };
  const r = rewriteWorkflow(wf, fixture, classify(wf, { triggerNode: 'Webhook' }).roles, { version: 'new', caseId: '1', replayVariant: 'code' });
  const push = r.workflow.nodes.find((n) => n.name === 'Push');
  const headers = (push?.parameters.headerParameters as { parameters: Array<{ name: string; value: string }> }).parameters;
  assert.deepEqual(headers, [{ name: 'X-Team', value: 'ops' }, { name: NODE_TAG_HEADER, value: 'Push' }]);
  const raw = r.workflow.nodes.find((n) => n.name === 'Raw');
  assert.equal(raw?.parameters.headerParameters, undefined);
});

test('S007 reports IF nodes with identical conditions', () => {
  const cond = { options: { version: 2 }, conditions: [{ id: 'c', leftValue: '={{ $json.x }}', rightValue: 'a', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' };
  const wf: N8nWorkflow = {
    name: 's007',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { conditions: cond, options: {} }, name: 'Check A', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [300, 0] },
      { parameters: { conditions: cond, options: {} }, name: 'Check B', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [600, 0] },
    ],
    connections: { Webhook: { main: [[{ node: 'Check A', type: 'main', index: 0 }]] }, 'Check A': { main: [[{ node: 'Check B', type: 'main', index: 0 }], []] } },
  };
  const r = scanWorkflow(wf, classify(wf, { triggerNode: 'Webhook' }));
  assert.ok(r.findings.some((f) => f.rule === 'S007' && f.message.includes('"Check A"') && f.message.includes('"Check B"')));
});
