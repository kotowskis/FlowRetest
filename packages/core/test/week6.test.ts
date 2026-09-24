import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiReplayWarnings, aiSubNodes, classify, isAiRoot } from '../src/classify.ts';
import { rewriteWorkflow } from '../src/rewrite.ts';
import { redactPlanReport, shapeOf } from '../src/redact.ts';
import { diffCase } from '../src/diff.ts';
import { normalizeCall } from '../src/normalize.ts';
import type { CaptureRecord } from '../src/capture.ts';
import type { Fixture } from '../src/fixture.ts';
import type { N8nWorkflow } from '../src/n8n.ts';

function aiWorkflow(prompt: string): N8nWorkflow {
  return {
    name: 'ai',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { promptType: 'define', text: prompt }, name: 'LLM Chain', type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1.7, position: [300, 0] },
      { parameters: { model: 'gpt-4o-mini' }, name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.2, position: [300, 200] },
      { parameters: {}, name: 'Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', typeVersion: 1, position: [400, 200] },
      { parameters: { method: 'POST', url: 'https://erp.example.com/x' }, name: 'Push', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [600, 0] },
    ],
    connections: {
      Webhook: { main: [[{ node: 'LLM Chain', type: 'main', index: 0 }]] },
      Model: { ai_languageModel: [[{ node: 'LLM Chain', type: 'ai_languageModel', index: 0 }]] },
      Memory: { ai_memory: [[{ node: 'LLM Chain', type: 'ai_memory', index: 0 }]] },
      'LLM Chain': { main: [[{ node: 'Push', type: 'main', index: 0 }]] },
    },
  };
}

const fixture: Fixture = {
  schemaVersion: 1,
  source: { workflowId: 'w', executionId: '1' },
  trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: { body: { q: 'hi' } } }] },
  nodes: { 'LLM Chain': { type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1.7, runs: [{ outputs: [[{ json: { text: 'hello' }, pairedItem: { item: 0 } }]] }] } },
  redacted: false,
};

test('AI roots are read nodes, sub-nodes are logic and get removed with the replayed root', () => {
  const wf = aiWorkflow('={{ $json.body.q }}');
  const subs = aiSubNodes(wf);
  assert.deepEqual([...subs].sort(), ['Memory', 'Model']);
  assert.ok(isAiRoot(wf.nodes[1] as never, subs));
  const c = classify(wf, { triggerNode: 'Webhook' });
  assert.equal(c.roles['LLM Chain'], 'read');
  assert.equal(c.roles.Model, 'logic');
  assert.equal(c.roles.Push, 'write');
  const r = rewriteWorkflow(wf, fixture, c.roles, { version: 'new', caseId: '1', replayVariant: 'code' });
  assert.deepEqual(r.removedSubNodes.sort(), ['Memory', 'Model']);
  assert.ok(!r.workflow.nodes.some((n) => n.name === 'Model' || n.name === 'Memory'));
  assert.equal(r.workflow.nodes.find((n) => n.name === 'LLM Chain')?.type, 'n8n-nodes-base.code');
  assert.equal(r.workflow.connections.Model, undefined);
});

test('stale AI replay is reported when the prompt or a sub-node changes, new AI nodes too', () => {
  assert.deepEqual(aiReplayWarnings(aiWorkflow('a'), aiWorkflow('a')), []);
  const changed = aiReplayWarnings(aiWorkflow('a'), aiWorkflow('b'));
  assert.equal(changed.length, 1);
  assert.match(changed[0] as string, /stale-ai-replay/);
  const modelChanged = aiWorkflow('a');
  (modelChanged.nodes[2] as { parameters: Record<string, unknown> }).parameters.model = 'gpt-4.1';
  assert.equal(aiReplayWarnings(aiWorkflow('a'), modelChanged).length, 1);
  const without = aiWorkflow('a');
  without.nodes = without.nodes.filter((n) => n.name !== 'LLM Chain');
  assert.match(aiReplayWarnings(without, aiWorkflow('a'))[0] as string, /no recording/);
});

test('report redaction keeps paths, counts and flags but replaces values by shapes', () => {
  const record = (v: string, body: unknown): CaptureRecord => ({ ts: 1, version: v, case: '1', method: 'POST', host: 'h', port: 443, path: '/p/123', query: { token: 'abc' }, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } });
  const oldCall = normalizeCall(record('old', { email: 'anna@firma.pl', n: 2 }), { node: 'Push', runIndex: 0 });
  const newCall = normalizeCall(record('new', { email: '', n: 2 }), { node: 'Push', runIndex: 0 });
  const d = diffCase('1', [oldCall], [newCall]);
  const red = redactPlanReport({ runner: '0', workflowName: 'w', engine: { image: 'i' }, oldLabel: 'o', newLabel: 'n', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true });
  const e = red.cases[0]?.entries[0];
  assert.equal(e?.fieldDiffs[0]?.path, 'email');
  assert.match(String(e?.fieldDiffs[0]?.old), /^<string 13 #[0-9a-f]{8}>$/);
  assert.match(String(e?.fieldDiffs[0]?.new), /^<string 0 #[0-9a-f]{8}>$/);
  assert.ok(e?.flags.includes('empty-value'));
  assert.equal((e?.new?.body as { n: number }).n, 2);
  assert.match(String((e?.new?.query as { token: string }).token), /^<string 3/);
  assert.equal(e?.new?.path, '/p/{id}');
  assert.ok(!JSON.stringify(red).includes('anna@firma.pl'));
  assert.equal(shapeOf('<ts>'), '<ts>');
});
