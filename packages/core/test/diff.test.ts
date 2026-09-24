import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeToNode, runWindows, type CaptureRecord } from '../src/capture.ts';
import { canonicalize, flatten, normalizeCall, placeholderFor, templatePath } from '../src/normalize.ts';
import { diffCase } from '../src/diff.ts';
import { renderPlan } from '../src/render.ts';

function record(over: Partial<CaptureRecord>): CaptureRecord {
  return {
    ts: 1000,
    version: 'new',
    case: '01',
    method: 'POST',
    host: 'erp.example.com',
    port: 443,
    path: '/api/orders',
    query: {},
    headers: {},
    bodyJson: { email: 'a@b.pl', customer_id: 'C-1' },
    bodyBytes: 10,
    bodySha256: 'x',
    rule: { id: 'generic-sink', kind: 'generic-sink' },
    response: { status: 200 },
    ...over,
  };
}

test('placeholders cover timestamps, uuids, epochs and tokens', () => {
  assert.equal(placeholderFor('2026-09-24T10:00:00.000Z'), '<ts>');
  assert.equal(placeholderFor('12345678-1234-4123-8123-123456789abc'), '<uuid>');
  assert.equal(placeholderFor('1790240536418'), '<epoch>');
  assert.equal(placeholderFor('Bearer abc.def'), '<token>');
  assert.equal(placeholderFor('C-1'), undefined);
});

test('path templating replaces id-like and email segments', () => {
  assert.equal(templatePath('/contacts/v1/contact/createOrUpdate/email/a%40b.pl'), '/contacts/v1/contact/createOrUpdate/email/{email}');
  assert.equal(templatePath('/v0/appFRTMOCK/tblFRTMOCK/recAbCdEfGhIjKlMn'), '/v0/appFRTMOCK/tblFRTMOCK/{id}');
  assert.equal(templatePath('/crm/v3/objects/contacts/12345'), '/crm/v3/objects/contacts/{id}');
});

test('canonicalize sorts keys, applies placeholders and ignore paths', () => {
  const out = canonicalize({ b: 1, a: { t: '2026-01-01T00:00:00Z', keep: 'x', drop: 'y' } }, { ignore: [['a', 'drop']], placeholders: true });
  assert.equal(JSON.stringify(out), '{"a":{"drop":"<ignored>","keep":"x","t":"<ts>"},"b":1}');
  assert.deepEqual([...flatten(out).keys()], ['a.drop', 'a.keep', 'a.t', 'b']);
});

test('attribution picks the node run whose window contains the request', () => {
  const windows = runWindows({ Webhook: [{ startTime: 100, executionTime: 5 }], Push: [{ startTime: 200, executionTime: 50 }, { startTime: 400, executionTime: 50 }] });
  assert.deepEqual(attributeToNode(220, windows), { node: 'Push', runIndex: 0 });
  assert.deepEqual(attributeToNode(455, windows), { node: 'Push', runIndex: 1 });
  assert.deepEqual(attributeToNode(300, windows), { node: '?', runIndex: -1 });
  // contiguous windows: a request 8 ms before the next node starts still belongs to the running node
  const contiguous = runWindows({ Push: [{ startTime: 1000, executionTime: 42 }], Loop: [{ startTime: 1042, executionTime: 1 }] });
  assert.deepEqual(attributeToNode(1034, contiguous), { node: 'Push', runIndex: 0 });
  assert.deepEqual(attributeToNode(1050, contiguous), { node: 'Loop', runIndex: 0 });
});

test('diff pairs exact, changed, added, removed and blocked calls with flags', () => {
  const norm = (r: Partial<CaptureRecord>, node = 'Push') => normalizeCall(record(r), { node, runIndex: 0 });
  const oldCalls = [norm({ version: 'old', bodyJson: { email: 'a@b.pl', customer_id: 'C-1' } }), norm({ version: 'old', bodyJson: { email: 'c@d.pl', customer_id: 'C-2' } }), norm({ version: 'old', path: '/api/audit', bodyJson: { x: 1 } }, 'Audit')];
  const newCalls = [norm({ bodyJson: { email: 'a@b.pl', customer_id: 'C-1' } }), norm({ bodyJson: { email: 'c@d.pl', customer_id: '' } }), norm({ path: '/api/extra', bodyJson: { y: 2 } }, 'Extra'), norm({ path: '/api/blocked', host: 'db.example.com', response: { status: 'close' } }, 'Db')];
  const d = diffCase('01', oldCalls, newCalls);
  assert.equal(d.status, 'BLOCKED');
  assert.deepEqual(d.summary, { oldCalls: 3, newCalls: 3, unchanged: 1, changed: 1, added: 1, removed: 1, blocked: 1 });
  const changed = d.entries.find((e) => e.op === '~');
  assert.deepEqual(changed?.fieldDiffs, [{ path: 'customer_id', old: 'C-2', new: '' }]);
  assert.ok(changed?.flags.includes('empty-value'));
  assert.equal(d.entries[0]?.op, '!');
  const noBlock = diffCase('01', oldCalls, newCalls.slice(0, 3));
  assert.equal(noBlock.status, 'DIFF');
  assert.equal(diffCase('01', oldCalls.slice(0, 2), newCalls.slice(0, 1).concat(oldCalls[1] as never)).status, 'PASS');
  assert.equal(diffCase('01', oldCalls, newCalls, { newError: 'boom' }).status, 'ERROR');
});

test('duplicate identical bodies in the new version are flagged', () => {
  const norm = (v: string, body: unknown) => normalizeCall(record({ version: v, bodyJson: body }), { node: 'Push', runIndex: 0 });
  const d = diffCase('02', [norm('old', { e: 'a' }), norm('old', { e: 'b' })], [norm('new', { e: 'a' }), norm('new', { e: 'a' })]);
  assert.ok(d.entries.some((e) => e.flags.includes('duplicate-bodies')));
});

test('renderPlan prints the header line and a changed entry', () => {
  const norm = (v: string, body: unknown) => normalizeCall(record({ version: v, bodyJson: body }), { node: 'Push', runIndex: 0 });
  const d = diffCase('01', [norm('old', { customer_id: 'C-1' })], [norm('new', { customer_id: '' })]);
  const text = renderPlan({ runner: '0.0.0', workflowName: 'Lead intake', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true });
  assert.match(text, /Plan: 1 calls \(old version: 1\)\. 1 changed, 0 added, 0 removed, 0 blocked\./);
  assert.match(text, /~ \[01\] Push/);
  assert.match(text, /customer_id: "C-1" -> ""/);
  assert.match(text, /empty value in an id field/);
  assert.match(text, /Result: DIFF \(exit code 1\)/);
});
