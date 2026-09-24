/** Rewriter regressions from the audit of weeks 1 to 8 (docs/audyt-2026-09-24.md, item 20). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.ts';
import { rewriteWorkflow } from '../src/rewrite.ts';
import type { Fixture } from '../src/fixture.ts';
import type { N8nWorkflow } from '../src/n8n.ts';

const baseFixture: Fixture = { schemaVersion: 1, source: { workflowId: 'w', executionId: '1' }, trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: {} }] }, nodes: {}, redacted: false };

test('20: a disabled Execute Workflow Trigger is removed, so it cannot become the start node', () => {
  const wf: N8nWorkflow = {
    name: 'sub',
    nodes: [
      { parameters: {}, name: 'Called', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 200], disabled: true },
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { method: 'POST', url: 'https://erp.example.com/x' }, name: 'Push', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [300, 0] },
    ],
    connections: { Webhook: { main: [[{ node: 'Push', type: 'main', index: 0 }]] }, Called: { main: [[{ node: 'Push', type: 'main', index: 0 }]] } },
  };
  const c = classify(wf, { triggerNode: 'Webhook' });
  assert.equal(c.roles.Called, 'trigger');
  const r = rewriteWorkflow(wf, baseFixture, c.roles, { version: 'new', caseId: '1', replayVariant: 'code' });
  assert.ok(r.removedTriggers.includes('Called'));
  assert.ok(!r.workflow.nodes.some((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger'));
});

test('20: a model shared with an agent that still runs stays; one used only by replayed roots goes', () => {
  const wf: N8nWorkflow = {
    name: 'agents',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: {}, name: 'Agent A', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 2, position: [300, 0] },
      { parameters: {}, name: 'Agent B', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 2, position: [300, 300] },
      { parameters: {}, name: 'Shared model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.2, position: [300, 150] },
      { parameters: {}, name: 'Memory A', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', typeVersion: 1, position: [400, 150] },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Agent A', type: 'main', index: 0 }, { node: 'Agent B', type: 'main', index: 0 }]] },
      'Shared model': { ai_languageModel: [[{ node: 'Agent A', type: 'ai_languageModel', index: 0 }, { node: 'Agent B', type: 'ai_languageModel', index: 0 }]] },
      'Memory A': { ai_memory: [[{ node: 'Agent A', type: 'ai_memory', index: 0 }]] },
    },
  };
  // Only Agent A has a recording; Agent B runs for real against the sink and needs its model.
  const fixture: Fixture = { ...baseFixture, nodes: { 'Agent A': { type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 2, runs: [{ outputs: [[{ json: { output: 'x' }, pairedItem: { item: 0 } }]] }] } } };
  const r = rewriteWorkflow(wf, fixture, classify(wf, { triggerNode: 'Webhook' }).roles, { version: 'new', caseId: '1', replayVariant: 'code' });
  const names = r.workflow.nodes.map((n) => n.name);
  assert.ok(names.includes('Shared model'));
  assert.ok(!names.includes('Memory A'));
  assert.deepEqual(r.removedSubNodes, ['Memory A']);
  const links = r.workflow.connections['Shared model']?.ai_languageModel?.flat().map((t) => t.node);
  assert.deepEqual(links, ['Agent B']);

  // With both agents recorded, the shared model goes too.
  const both: Fixture = { ...fixture, nodes: { ...fixture.nodes, 'Agent B': { type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 2, runs: [{ outputs: [[{ json: { output: 'y' }, pairedItem: { item: 0 } }]] }] } } };
  const r2 = rewriteWorkflow(wf, both, classify(wf, { triggerNode: 'Webhook' }).roles, { version: 'new', caseId: '1', replayVariant: 'code' });
  assert.ok(!r2.workflow.nodes.some((n) => n.name === 'Shared model'));
});
