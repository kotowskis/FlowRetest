import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStubs, classify } from '../src/classify.ts';
import { rewriteWorkflow } from '../src/rewrite.ts';
import type { Fixture } from '../src/fixture.ts';
import type { N8nWorkflow } from '../src/n8n.ts';

const serviceRole = (node: { type: string; parameters: Record<string, unknown> }) =>
  node.type === 'n8n-nodes-base.postgres' ? { role: 'unsupported' as const, note: 'database write' } : undefined;

const wf: N8nWorkflow = {
  name: 'stub',
  nodes: [
    { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    { parameters: { operation: 'insert' }, name: 'Upsert order', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [200, 0] },
    { parameters: { method: 'POST', url: 'https://erp.example.com/x' }, name: 'Push', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, 0] },
  ],
  connections: { Webhook: { main: [[{ node: 'Upsert order', type: 'main', index: 0 }]] }, 'Upsert order': { main: [[{ node: 'Push', type: 'main', index: 0 }]] } },
};
const fixture: Fixture = { schemaVersion: 1, source: { workflowId: 'w', executionId: '1' }, trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: { a: 1 } }, { json: { a: 2 } }] }, nodes: {}, redacted: false };

test('a stubbed database write no longer skips the case and is answered from the stub', () => {
  const plain = classify(wf, { triggerNode: 'Webhook', serviceRole });
  assert.deepEqual(plain.unsupportedOnPath, ['Upsert order']);
  const stubbed = applyStubs(plain, ['Upsert order', 'Webhook', 'Missing']);
  assert.deepEqual(stubbed.unsupportedOnPath, []);
  assert.equal(stubbed.roles['Upsert order'], 'read');
  assert.equal(stubbed.roles.Webhook, 'trigger', 'the recorded trigger is never stubbed');

  const r = rewriteWorkflow(wf, fixture, stubbed.roles, { version: 'new', caseId: '1', replayVariant: 'code', stubs: { 'Upsert order': [{ id: 42 }, { id: 43 }], Missing: [{}] } });
  assert.deepEqual(r.replaced.find((x) => x.node === 'Upsert order')?.kind, 'stub');
  assert.ok(r.warnings.some((w) => w.includes('stub for "Missing" ignored')));
  const node = r.workflow.nodes.find((n) => n.name === 'Upsert order');
  assert.equal(node?.type, 'n8n-nodes-base.code');
  const run = new Function('$input', '$runIndex', String(node?.parameters.jsCode)) as (input: { all: () => unknown[] }, runIndex: number) => unknown;
  assert.deepEqual(run({ all: () => [{}, {}] }, 0), [{ json: { id: 42 }, pairedItem: { item: 0 } }, { json: { id: 43 }, pairedItem: { item: 1 } }]);
  // the write after it still runs and is captured
  assert.equal(r.workflow.nodes.find((n) => n.name === 'Push')?.type, 'n8n-nodes-base.httpRequest');
});
