import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.ts';
import type { N8nWorkflow } from '../src/n8n.ts';
import { renderScan, scanDiff, scanWorkflow } from '../src/scan.ts';

function wf(): N8nWorkflow {
  return {
    name: 'scan',
    nodes: [
      { id: 'n1', parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { id: 'n2', parameters: { mode: 'combine', combineBy: 'combineByPosition' }, name: 'Merge', type: 'n8n-nodes-base.merge', typeVersion: 3, position: [300, 0] },
      { id: 'n3', parameters: { assignments: { assignments: [{ id: 'a', name: 'email', value: "={{ $('Webhook').item.json.body.email }}", type: 'string' }] } }, name: 'Map', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [600, 0] },
      { id: 'n4', parameters: { method: 'POST', url: 'http://localhost:5678/webhook/x', options: { proxy: 'http://corp:3128' } }, name: 'Push', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [900, 0], credentials: { httpHeaderAuth: { id: 'c1', name: 'ERP' } } },
      { id: 'n5', parameters: { jsCode: 'return [{ json: { k: process.env.SECRET } }];', language: 'javaScript' }, name: 'Env', type: 'n8n-nodes-base.code', typeVersion: 2, position: [900, 200] },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Merge', type: 'main', index: 0 }, { node: 'Merge', type: 'main', index: 1 }]] },
      Merge: { main: [[{ node: 'Map', type: 'main', index: 0 }]] },
      Map: { main: [[{ node: 'Push', type: 'main', index: 0 }, { node: 'Env', type: 'main', index: 0 }]] },
    },
  };
}

test('single-version scan reports pairing, proxy, localhost and env findings', () => {
  const w = wf();
  const c = classify(w, { triggerNode: 'Webhook' });
  const r = scanWorkflow(w, c);
  const rules = r.findings.map((f) => f.rule).sort();
  assert.deepEqual(rules, ['S000', 'S005', 'S006', 'S008', 'S013']);
  assert.equal(r.support.find((s) => s.node === 'Push')?.status, 'unsupported');
  assert.equal(r.support.find((s) => s.node === 'Webhook')?.status, 'trigger');
  assert.match(renderScan(r), /S005 \[Map\]/);
});

test('dangling reference after a rename is an error', () => {
  const w = wf();
  const map = w.nodes.find((n) => n.name === 'Map');
  if (map) map.parameters = { assignments: { assignments: [{ id: 'a', name: 'email', value: "={{ $('Hook').item.json.body.email }}", type: 'string' }] } };
  const r = scanWorkflow(w, classify(w, { triggerNode: 'Webhook' }));
  assert.ok(r.findings.some((f) => f.rule === 'S002' && f.node === 'Map'));
});

test('diff scan reports version, toggle, credential, rename and connection changes', () => {
  const before = wf();
  const after = wf();
  const push = after.nodes.find((n) => n.name === 'Push');
  if (push) {
    push.typeVersion = 4.3;
    push.executeOnce = true;
    push.credentials = { httpHeaderAuth: { id: 'c2', name: 'ERP prod' } };
  }
  const map = after.nodes.find((n) => n.name === 'Map');
  if (map) map.name = 'Map fields';
  after.connections['Merge'] = { main: [[{ node: 'Map fields', type: 'main', index: 0 }]] };
  after.connections['Map fields'] = after.connections['Map'] as never;
  delete after.connections['Map'];
  const findings = scanDiff(before, after);
  const rules = new Set(findings.map((f) => f.rule));
  for (const r of ['S001', 'S003', 'S004', 'S009', 'S010']) assert.ok(rules.has(r), `missing ${r}`);
  assert.ok(findings.some((f) => f.rule === 'S010' && f.message.includes('"Map"')));
});
