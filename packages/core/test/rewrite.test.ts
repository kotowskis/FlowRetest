import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.ts';
import type { Fixture } from '../src/fixture.ts';
import { fixtureFromExecution } from '../src/fixture.ts';
import type { N8nWorkflow } from '../src/n8n.ts';
import { referencedNodeNames, workflowId } from '../src/n8n.ts';
import { rewriteWorkflow, START_NODE } from '../src/rewrite.ts';

function sampleWorkflow(): N8nWorkflow {
  return {
    id: 'orig',
    name: 'Lead intake',
    versionId: 'v1',
    pinData: { Webhook: [] },
    nodes: [
      { parameters: { path: 'lead' }, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: {}, name: 'Every day', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 200] },
      { parameters: { method: 'GET', url: 'https://crm.example.com/customers' }, name: 'Lookup', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [300, 0] },
      { parameters: { assignments: { assignments: [{ id: 'a', name: 'email', value: "={{ $('Webhook').item.json.body.email }}", type: 'string' }] } }, name: 'Map', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [600, 0] },
      { parameters: { method: 'POST', url: 'https://erp.example.com/orders' }, name: 'Push', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [900, 0], credentials: { httpHeaderAuth: { id: 'c1', name: 'ERP' } } },
      { parameters: {}, name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [1200, 0] },
      { parameters: { operation: 'insert' }, name: 'Archive', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [1200, 200] },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Lookup', type: 'main', index: 0 }]] },
      'Every day': { main: [[{ node: 'Lookup', type: 'main', index: 0 }]] },
      Lookup: { main: [[{ node: 'Map', type: 'main', index: 0 }]] },
      Map: { main: [[{ node: 'Push', type: 'main', index: 0 }]] },
      Push: { main: [[{ node: 'Respond', type: 'main', index: 0 }, { node: 'Archive', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', errorWorkflow: 'err' },
  };
}

function sampleFixture(): Fixture {
  return {
    schemaVersion: 1,
    source: { workflowId: 'orig', executionId: '1' },
    trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: { body: { email: 'a@b.pl' } } }, { json: { body: { email: 'c@d.pl' } } }] },
    nodes: {
      Webhook: { type: 'n8n-nodes-base.webhook', typeVersion: 2, runs: [{ outputs: [[{ json: { body: { email: 'a@b.pl' } } }, { json: { body: { email: 'c@d.pl' } } }]] }] },
      Lookup: { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, runs: [{ outputs: [[{ json: { id: 'C-1' }, pairedItem: { item: 0 } }, { json: { id: 'C-2' }, pairedItem: { item: 1 } }]] }] },
    },
    redacted: false,
  };
}

test('classify assigns roles and finds unsupported nodes on the path', () => {
  const c = classify(sampleWorkflow(), { triggerNode: 'Webhook' });
  assert.equal(c.roles.Webhook, 'trigger');
  assert.equal(c.roles['Every day'], 'trigger');
  assert.equal(c.roles.Lookup, 'read');
  assert.equal(c.roles.Map, 'logic');
  assert.equal(c.roles.Push, 'write');
  assert.equal(c.roles.Respond, 'replace');
  assert.equal(c.roles.Archive, 'unsupported');
  assert.deepEqual(c.unsupportedOnPath, ['Archive']);
});

test('rewrite with the code variant replaces trigger and read node, keeps names and connections', () => {
  const c = classify(sampleWorkflow(), { triggerNode: 'Webhook' });
  const r = rewriteWorkflow(sampleWorkflow(), sampleFixture(), c.roles, { version: 'new', caseId: '01', replayVariant: 'code' });
  const names = r.workflow.nodes.map((n) => n.name);
  assert.ok(names.includes(START_NODE));
  assert.ok(!names.includes('Every day'));
  assert.deepEqual(r.removedTriggers, ['Every day']);
  const webhook = r.workflow.nodes.find((n) => n.name === 'Webhook');
  assert.equal(webhook?.type, 'n8n-nodes-base.code');
  assert.match(String(webhook?.parameters.jsCode), /a@b\.pl/);
  const lookup = r.workflow.nodes.find((n) => n.name === 'Lookup');
  assert.equal(lookup?.type, 'n8n-nodes-base.code');
  assert.match(String(lookup?.parameters.jsCode), /pairedItem/);
  const respond = r.workflow.nodes.find((n) => n.name === 'Respond');
  assert.equal(respond?.type, 'n8n-nodes-base.noOp');
  assert.deepEqual(r.workflow.connections[START_NODE], { main: [[{ node: 'Webhook', type: 'main', index: 0 }]] });
  assert.deepEqual(r.workflow.connections.Webhook, { main: [[{ node: 'Lookup', type: 'main', index: 0 }]] });
  assert.equal(r.workflow.id, workflowId('frt/new/01'));
  assert.equal(r.workflow.name, 'frt/new/01');
  assert.equal(r.workflow.pinData, undefined);
  assert.equal((r.workflow.settings as { errorWorkflow?: string }).errorWorkflow, undefined);
  assert.deepEqual(r.credentials, [{ type: 'httpHeaderAuth', id: 'c1', name: 'ERP', node: 'Push' }]);
  assert.equal(r.replaced.length, 3);
});

test('rewrite with the set variant inserts an Edit Fields node in front of a Split Out that carries the name', () => {
  const c = classify(sampleWorkflow(), { triggerNode: 'Webhook' });
  const r = rewriteWorkflow(sampleWorkflow(), sampleFixture(), c.roles, { version: 'old', caseId: '01', replayVariant: 'set' });
  const set = r.workflow.nodes.find((n) => n.name === 'frt:replay:Lookup');
  const split = r.workflow.nodes.find((n) => n.name === 'Lookup');
  assert.equal(set?.type, 'n8n-nodes-base.set');
  assert.equal(set?.executeOnce, true);
  assert.equal(split?.type, 'n8n-nodes-base.splitOut');
  assert.deepEqual(r.workflow.connections.Webhook, { main: [[{ node: 'frt:replay:Lookup', type: 'main', index: 0 }]] });
  assert.deepEqual(r.workflow.connections['frt:replay:Lookup'], { main: [[{ node: 'Lookup', type: 'main', index: 0 }]] });
  assert.deepEqual(r.workflow.connections[START_NODE], { main: [[{ node: 'frt:replay:Webhook', type: 'main', index: 0 }]] });
  assert.equal(JSON.parse(String(set?.parameters.jsonOutput)).items.length, 2);
});

test('read node without recording stays and is reported', () => {
  const fixture = sampleFixture();
  delete fixture.nodes.Lookup;
  const c = classify(sampleWorkflow(), { triggerNode: 'Webhook' });
  const r = rewriteWorkflow(sampleWorkflow(), fixture, c.roles, { version: 'new', caseId: '01', replayVariant: 'code' });
  assert.deepEqual(r.unreplayed, ['Lookup']);
  assert.equal(r.workflow.nodes.find((n) => n.name === 'Lookup')?.type, 'n8n-nodes-base.httpRequest');
  assert.equal(r.warnings.length, 1);
});

test('multi-run recordings become an expression that never contains a closing double brace', () => {
  const fixture = sampleFixture();
  fixture.nodes.Lookup = {
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    runs: [{ outputs: [[{ json: { a: { b: 1 } } }]] }, { outputs: [[{ json: { a: { b: 2 } } }]] }],
  };
  const c = classify(sampleWorkflow(), { triggerNode: 'Webhook' });
  const r = rewriteWorkflow(sampleWorkflow(), fixture, c.roles, { version: 'new', caseId: '01', replayVariant: 'set' });
  const expr = String(r.workflow.nodes.find((n) => n.name === 'frt:replay:Lookup')?.parameters.jsonOutput);
  assert.ok(expr.startsWith('={{'));
  assert.ok(!expr.slice(3, -2).includes('}}'));
  assert.match(expr, /\$runIndex/);
});

test('fixtureFromExecution picks the trigger and records runs per node', () => {
  const wf = sampleWorkflow();
  const fixture = fixtureFromExecution(
    {
      id: 42,
      workflowId: 'orig',
      mode: 'webhook',
      status: 'success',
      data: {
        resultData: {
          runData: {
            Webhook: [{ startTime: 1, executionTime: 1, data: { main: [[{ json: { body: { email: 'x' } } }]] } }],
            Lookup: [{ startTime: 2, executionTime: 5, source: [{ previousNode: 'Webhook' }], data: { main: [[{ json: { id: 1 }, pairedItem: { item: 0 } }]] } }],
          },
        },
      },
    },
    wf,
    'n8n.example',
  );
  assert.equal(fixture.trigger.node, 'Webhook');
  assert.equal(fixture.trigger.items.length, 1);
  assert.equal(fixture.nodes.Lookup?.runs[0]?.inputCount, 1);
  assert.equal(fixture.source.executionId, '42');
});

test('referencedNodeNames finds every expression form', () => {
  assert.deepEqual(referencedNodeNames(`{{ $('Webhook').item.json }} {{ $("Lookup").first() }} {{ $node["Map"].json }} {{ $items('Push') }}`).sort(), ['Lookup', 'Map', 'Push', 'Webhook']);
});
