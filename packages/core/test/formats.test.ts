import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaptureRecord } from '../src/capture.ts';
import { normalizeCall } from '../src/normalize.ts';
import { diffCase } from '../src/diff.ts';
import { renderJUnit, renderMarkdown } from '../src/render-formats.ts';
import { Redactor } from '../src/redact.ts';
import type { Fixture } from '../src/fixture.ts';

function call(version: string, body: unknown): ReturnType<typeof normalizeCall> {
  const record: CaptureRecord = { ts: 1, version, case: 'c', method: 'POST', host: 'h', port: 443, path: '/p', query: {}, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
  return normalizeCall(record, { node: 'Push', runIndex: 0 });
}

const report = () => ({
  runner: '0.2.0',
  workflowName: 'Lead <intake>',
  engine: { image: 'n8nio/n8n:2.40.5' },
  oldLabel: 'recorded',
  newLabel: 'draft.json',
  cases: [diffCase('7', [call('old', { customer_id: 'C-1' })], [call('new', { customer_id: '' })]), diffCase('8', [call('old', { a: 1 })], [call('new', { a: 1 })]), diffCase('9', [], [], { newError: 'Map: boom' })],
  coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] },
  sealed: true,
});

test('JUnit has one testcase per case with failures for DIFF and ERROR', () => {
  const xml = renderJUnit(report());
  assert.match(xml, /tests="3" failures="2" skipped="0"/);
  assert.match(xml, /name="Lead &lt;intake&gt;"/);
  assert.match(xml, /<testcase classname="flowretest" name="case 8"\/>/);
  assert.match(xml, /name="case 9"><failure message="Map: boom"/);
  assert.match(xml, /customer_id: &quot;C-1&quot; -&gt; &quot;&quot;/);
});

test('Markdown has a summary table, collapsible details and stays under 60 kB', () => {
  const md = renderMarkdown(report());
  assert.match(md, /^## FlowRetest: ERROR for "Lead <intake>"/);
  assert.match(md, /\| 7 \| DIFF \| 1 \| 0 \| 0 \| 0 \|/);
  assert.match(md, /<details>\n<summary>case 7: DIFF/);
  assert.match(md, /- case 8: PASS/);
  const big = report();
  big.cases = Array.from({ length: 400 }, (_, i) => diffCase(String(i), [call('old', { v: 'x'.repeat(200) })], [call('new', { v: 'y'.repeat(200) })]));
  const capped = renderMarkdown(big);
  assert.ok(capped.length <= 60 * 1024, `size ${capped.length}`);
  assert.match(capped, /case sections omitted/);
});

test('redaction keeps types, lengths and joins, drops emails and names', () => {
  const r = new Redactor({ salt: 'test' });
  const fixture: Fixture = {
    schemaVersion: 1,
    source: { workflowId: 'w', executionId: '1', instanceHost: 'n8n.client.example' },
    trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: { body: { email: 'anna.kowalska@firma.pl', name: 'Anna Kowalska', phone: '+48 601 234 567', customer_id: 'C-1', created: '2026-09-24T10:00:00Z', amount: 12.5 } } }] },
    nodes: { Lookup: { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, runs: [{ outputs: [[{ json: { email: 'anna.kowalska@firma.pl', id: 'C-1' } }]] }] } },
    redacted: false,
  };
  const out = r.redactFixture(fixture);
  const body = (out.trigger.items[0]?.json as { body: Record<string, unknown> }).body;
  assert.notEqual(body.email, 'anna.kowalska@firma.pl');
  assert.equal(String(body.email).length, 'anna.kowalska@firma.pl'.length);
  assert.match(String(body.email), /^[a-z]{4}\.[a-z]{8}@[a-z]{5}\.pl$/);
  assert.equal((out.nodes.Lookup?.runs[0]?.outputs[0]?.[0]?.json as { email: string }).email, body.email);
  assert.notEqual(body.name, 'Anna Kowalska');
  assert.equal(String(body.name).length, 'Anna Kowalska'.length);
  assert.match(String(body.name), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.notEqual(body.phone, '+48 601 234 567');
  assert.equal(body.customer_id, 'C-1');
  assert.equal(body.created, '2026-09-24T10:00:00Z');
  assert.equal(body.amount, 12.5);
  assert.equal(out.redacted, true);
  assert.equal(out.source.instanceHost, 'redacted.example');
});
