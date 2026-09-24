/**
 * Regressions from the audit of weeks 1 to 8 (docs/audyt-2026-09-24.md, items 6 to 16): changes the diff used to
 * report as PASS, and node names that broke the sandbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeRecord, runWindows, type CaptureRecord } from '../src/capture.ts';
import { flatten, normalizeCall, placeholderFor, splitFlatPath } from '../src/normalize.ts';
import { diffCase } from '../src/diff.ts';
import { detectVolatile, fromBaseline, maskVolatile, runsIdentical, toBaseline } from '../src/baseline.ts';
import { classify } from '../src/classify.ts';
import { rewriteWorkflow, NODE_TAG_HEADER } from '../src/rewrite.ts';
import type { Fixture } from '../src/fixture.ts';
import type { N8nWorkflow } from '../src/n8n.ts';

const NOW = Date.parse('2026-09-24T10:00:00Z');

function record(over: Partial<CaptureRecord>): CaptureRecord {
  return { ts: NOW, version: 'new', case: 'c', method: 'PATCH', host: 'api.hubapi.com', port: 443, path: '/crm/v3/objects/contacts/123', query: {}, headers: {}, contentType: 'application/json', bodyJson: { properties: { email: 'a@b.pl' } }, bodyBytes: 10, bodySha256: 'x', rule: { id: 'hubspot.crm.objects.update', kind: 'template' }, response: { status: 200 }, ...over };
}

const norm = (over: Partial<CaptureRecord>, node = 'Update') => normalizeCall(record(over), { node, runIndex: 0 });

test('6: a call to another record id is a change, generated ids in the path are not', () => {
  const d = diffCase('c', [norm({ version: 'old' })], [norm({ path: '/crm/v3/objects/contacts/456' })]);
  assert.equal(d.status, 'DIFF');
  assert.deepEqual(d.entries[0]?.fieldDiffs, [{ path: '@path', old: '/crm/v3/objects/contacts/123', new: '/crm/v3/objects/contacts/456' }]);
  const email = diffCase('c', [norm({ version: 'old', path: '/contacts/v1/contact/email/a%40b.pl/profile' })], [norm({ path: '/contacts/v1/contact/email/x%40y.pl/profile' })]);
  assert.equal(email.status, 'DIFF');
  const uuids = diffCase('c', [norm({ version: 'old', path: '/v1/pages/12345678-1234-4123-8123-123456789abc' })], [norm({ path: '/v1/pages/87654321-1234-4123-8123-123456789abc' })]);
  assert.equal(uuids.status, 'PASS');
  assert.equal(diffCase('c', [norm({ version: 'old' })], [norm({})]).status, 'PASS');
});

test('7: bodies the proxy did not store are compared by size and hash', () => {
  const big = (sha: string, bytes: number) => norm({ bodyJson: undefined, body: undefined, bodyBytes: bytes, bodySha256: sha });
  assert.equal(diffCase('c', [big('aaa', 300_000)], [big('bbb', 900_000)]).status, 'DIFF');
  assert.equal(diffCase('c', [big('aaa', 300_000)], [big('aaa', 300_000)]).status, 'PASS');
});

test('10: bare dates and 10-digit ids are real values; time fields and run-time epochs are placeholders', () => {
  const due = diffCase('c', [norm({ version: 'old', bodyJson: { due_date: '2026-10-01' } })], [norm({ bodyJson: { due_date: '2027-01-31' } })]);
  assert.equal(due.status, 'DIFF');
  const chat = diffCase('c', [norm({ version: 'old', bodyJson: { chat_id: 1712345678 } })], [norm({ bodyJson: { chat_id: 2012345678 } })]);
  assert.equal(chat.status, 'DIFF');
  const created = diffCase('c', [norm({ version: 'old', bodyJson: { created_at: 1712345678 } })], [norm({ bodyJson: { created_at: 1712349999 } })]);
  assert.equal(created.status, 'PASS');
  const nonce = diffCase('c', [norm({ version: 'old', bodyJson: { value: String(Math.floor(NOW / 1000)) } })], [norm({ bodyJson: { value: String(Math.floor(NOW / 1000) + 3) } })]);
  assert.equal(nonce.status, 'PASS');
  assert.equal(placeholderFor('2026-10-01'), undefined);
  assert.equal(placeholderFor('2026-10-01T08:00:00Z'), '<ts>');
  assert.equal(placeholderFor('1712345678', { key: 'chat_id' }), undefined);
  assert.equal(placeholderFor('1712345678', { key: 'updatedAt' }), '<epoch>');
});

test('11: volatile fields are scoped to one call key, cover query and path, and survive dotted keys', () => {
  const log = (v: string, id: string) => norm({ version: v, method: 'POST', path: '/log', bodyJson: { id } }, 'Log');
  const upsert = (v: string, id: string) => norm({ version: v, method: 'POST', path: '/upsert', bodyJson: { id } }, 'Upsert');
  const volatile = detectVolatile([log('old', 'r1'), upsert('old', 'C-1')], [log('old2', 'r2'), upsert('old2', 'C-1')]);
  assert.deepEqual(volatile, ['Log|POST|api.hubapi.com|/log :: id']);
  const d = diffCase('c', maskVolatile([log('old', 'r1'), upsert('old', 'C-1')], volatile), maskVolatile([log('new', 'r3'), upsert('new', 'C-999')], volatile));
  assert.equal(d.summary.changed, 1);
  assert.equal(d.entries.find((e) => e.op === '~')?.node, 'Upsert');

  const signed = (v: string, sig: string) => norm({ version: v, query: { sig } });
  const sigVolatile = detectVolatile([signed('old', 'a1')], [signed('old2', 'b2')]);
  assert.deepEqual(sigVolatile, ['Update|PATCH|api.hubapi.com|/crm/v3/objects/contacts/{id} :: ?sig']);
  assert.ok(runsIdentical(maskVolatile([signed('old', 'a1')], sigVolatile), maskVolatile([signed('old2', 'b2')], sigVolatile)));

  const dotted = (v: string, t: string) => norm({ version: v, bodyJson: { 'meta.trace': t, meta: { trace: 'same' } } });
  const dotVolatile = detectVolatile([dotted('old', 't1')], [dotted('old2', 't2')]);
  assert.deepEqual(dotVolatile, ['Update|PATCH|api.hubapi.com|/crm/v3/objects/contacts/{id} :: ["meta.trace"]']);
  const masked = maskVolatile([dotted('old', 't1')], dotVolatile)[0]?.body as Record<string, unknown>;
  assert.equal(masked['meta.trace'], '<volatile>');
  assert.deepEqual(masked.meta, { trace: 'same' });
  assert.deepEqual(splitFlatPath('a.b[2]["c.d"]'), ['a', 'b', '2', 'c.d']);
  assert.deepEqual([...flatten({ 'a.b': 1, a: { b: 2 } }).keys()], ['["a.b"]', 'a.b']);

  // entries written before 0.3.0 had no key and still mask the body of every call
  assert.equal((maskVolatile([log('old', 'r1')], ['id'])[0]?.body as { id: string }).id, '<volatile>');
});

test('11: a baseline serialised to JSON and read back still pairs exactly', () => {
  const calls = [norm({ bodyJson: { a: 1 } }), norm({ path: '/crm/v3/objects/contacts/9', bodyJson: { a: 2 } })];
  const baseline = JSON.parse(JSON.stringify(toBaseline('c', calls, { acceptedAt: '2026-09-24T00:00:00Z', runnerVersion: '0.0.0' })));
  const d = diffCase('c', fromBaseline(baseline), calls);
  assert.equal(d.status, 'PASS');
  assert.equal(d.summary.unchanged, 2);
});

test('12: a changed media type and repeated query values are visible', () => {
  const json = norm({ version: 'old', method: 'POST', bodyJson: { a: 'x' } });
  const form = norm({ method: 'POST', contentType: 'application/x-www-form-urlencoded', bodyJson: { a: 'x' } });
  const d = diffCase('c', [json], [form]);
  assert.equal(d.status, 'DIFF');
  assert.deepEqual(d.entries[0]?.fieldDiffs, [{ path: '@contentType', old: 'application/json', new: 'application/x-www-form-urlencoded' }]);
  assert.equal(diffCase('c', [norm({ version: 'old', contentType: 'application/json; charset=utf-8' })], [norm({ contentType: 'application/json' })]).status, 'PASS');
  const tags = diffCase('c', [norm({ version: 'old', query: { tag: ['a', 'b'] } })], [norm({ query: { tag: 'b' } })]);
  assert.equal(tags.status, 'DIFF');
});

const webhookFixture: Fixture = { schemaVersion: 1, source: { workflowId: 'w', executionId: '1' }, trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: {} }] }, nodes: {}, redacted: false };

test('16: node names outside Latin-1 are percent-encoded in the tag header and decoded on attribution', () => {
  const name = 'Wyślij do CRM';
  const wf: N8nWorkflow = {
    name: 'tag',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { method: 'POST', url: 'https://erp.example.com/x' }, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [300, 0] },
    ],
    connections: { Webhook: { main: [[{ node: name, type: 'main', index: 0 }]] } },
  };
  const r = rewriteWorkflow(wf, webhookFixture, classify(wf, { triggerNode: 'Webhook' }).roles, { version: 'new', caseId: '1', replayVariant: 'code' });
  const headers = (r.workflow.nodes.find((n) => n.name === name)?.parameters.headerParameters as { parameters: Array<{ name: string; value: string }> }).parameters;
  const tag = headers.find((h) => h.name === NODE_TAG_HEADER)?.value ?? '';
  assert.match(tag, /^[\x20-\x7e]+$/);
  const windows = runWindows({ [name]: [{ startTime: 100, executionTime: 50 }] });
  assert.deepEqual(attributeRecord({ ts: 120, headers: { 'x-flowretest-node': tag } }, windows), { node: name, runIndex: 0 });
});

test('16: a line break in a replayed node name cannot inject code into the replay node', () => {
  const name = 'Lookup\nthrow new Error("injected")';
  const wf: N8nWorkflow = {
    name: 'inject',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { method: 'GET', url: 'https://erp.example.com/x' }, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [300, 0] },
    ],
    connections: { Webhook: { main: [[{ node: name, type: 'main', index: 0 }]] } },
  };
  const fixture: Fixture = { ...webhookFixture, nodes: { [name]: { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, runs: [{ outputs: [[{ json: { ok: 1 }, pairedItem: { item: 0 } }]] }] } } };
  const r = rewriteWorkflow(wf, fixture, classify(wf, { triggerNode: 'Webhook' }).roles, { version: 'new', caseId: '1', replayVariant: 'code' });
  const replay = r.workflow.nodes.find((n) => n.type === 'n8n-nodes-base.code' && String(n.parameters.jsCode).includes('"ok":1'));
  const jsCode = String(replay?.parameters.jsCode);
  // Run the generated code the way the Code node does, with $input and $runIndex in scope.
  const run = new Function('$input', '$runIndex', jsCode) as (input: { all: () => unknown[] }, runIndex: number) => unknown;
  assert.deepEqual(run({ all: () => [{}] }, 0), [{ json: { ok: 1 }, pairedItem: { item: 0 } }]);
});

test('8: HTTP Request v1 and v2 keep the verb in requestMethod', () => {
  const wf: N8nWorkflow = {
    name: 'v1',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, position: [0, 0] },
      { parameters: { requestMethod: 'POST', url: 'https://erp.example.com/x' }, name: 'Post v1', type: 'n8n-nodes-base.httpRequest', typeVersion: 1, position: [300, 0] },
      { parameters: { url: 'https://erp.example.com/x' }, name: 'Get v2', type: 'n8n-nodes-base.httpRequest', typeVersion: 2, position: [600, 0] },
    ],
    connections: {},
  };
  const roles = classify(wf, { triggerNode: 'Webhook' }).roles;
  assert.equal(roles['Post v1'], 'write');
  assert.equal(roles['Get v2'], 'read');
});

test('15: vector store inserts are unsupported, loads stay replayed AI reads', () => {
  const wf: N8nWorkflow = {
    name: 'vs',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { mode: 'insert' }, name: 'Store', type: '@n8n/n8n-nodes-langchain.vectorStorePinecone', typeVersion: 1.3, position: [300, 0] },
      { parameters: { mode: 'load', prompt: 'x' }, name: 'Load', type: '@n8n/n8n-nodes-langchain.vectorStorePinecone', typeVersion: 1.3, position: [600, 0] },
      { parameters: {}, name: 'Legacy', type: '@n8n/n8n-nodes-langchain.vectorStoreSupabaseInsert', typeVersion: 1, position: [900, 0] },
    ],
    connections: { Webhook: { main: [[{ node: 'Store', type: 'main', index: 0 }, { node: 'Load', type: 'main', index: 0 }, { node: 'Legacy', type: 'main', index: 0 }]] } },
  };
  const c = classify(wf, { triggerNode: 'Webhook' });
  assert.equal(c.roles.Store, 'unsupported');
  assert.equal(c.roles.Legacy, 'unsupported');
  assert.equal(c.roles.Load, 'read');
  assert.deepEqual(c.unsupportedOnPath.sort(), ['Legacy', 'Store']);
});
