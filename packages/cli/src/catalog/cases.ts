/**
 * Regression catalogue: workflow pairs (old, new) with a fixture, each showing
 * a change that n8n executes green but that sends the wrong thing. Built in
 * code so tests and the spike share them; exported to catalog/ as JSON later.
 */
import type { Fixture, N8nNode, N8nWorkflow, RecordedItem } from '@flowretest/core';

export interface CatalogCase {
  id: string;
  title: string;
  expect: string;
  old: N8nWorkflow;
  new: N8nWorkflow;
  fixture: Fixture;
  /** Run the old version twice and mask fields that differ between the runs before diffing. */
  stabilize?: boolean;
}

const rl = (mode: string, value: string) => ({ __rl: true, mode, value });

function webhook(): N8nNode {
  return { parameters: { path: 'lead', httpMethod: 'POST' }, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] };
}

function webhookItems(): RecordedItem[] {
  return [
    { json: { headers: {}, params: {}, query: {}, body: { email: 'a@b.pl', customer_id: 'C-1' } } },
    { json: { headers: {}, params: {}, query: {}, body: { email: 'c@d.pl', customer_id: 'C-2' } } },
  ];
}

function map(name: string, position: [number, number], assignments: Array<[string, string]>): N8nNode {
  return {
    parameters: { assignments: { assignments: assignments.map(([field, value], i) => ({ id: `a${i}`, name: field, value, type: 'string' })) }, includeOtherFields: false, options: {} },
    name,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position,
  };
}

function push(name: string, position: [number, number]): N8nNode {
  return {
    parameters: { method: 'POST', url: 'https://erp.example.com/api/orders', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json) }}', options: {} },
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
  };
}

function lookup(name: string, position: [number, number]): N8nNode {
  return { parameters: { method: 'GET', url: 'https://crm.example.com/customers', options: {} }, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position };
}

function chain(...names: string[]): N8nWorkflow['connections'] {
  const connections: N8nWorkflow['connections'] = {};
  for (let i = 0; i < names.length - 1; i++) connections[names[i] as string] = { main: [[{ node: names[i + 1] as string, type: 'main', index: 0 }]] };
  return connections;
}

function fixture(nodes: Fixture['nodes'] = {}): Fixture {
  return {
    schemaVersion: 1,
    source: { workflowId: 'catalog', executionId: '0' },
    trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: webhookItems() },
    nodes: { Webhook: { type: 'n8n-nodes-base.webhook', typeVersion: 2, runs: [{ outputs: [webhookItems()] }] }, ...nodes },
    redacted: false,
  };
}

export function catalogCases(): CatalogCase[] {
  const cases: CatalogCase[] = [];

  // 01: a field in the lookup response is mapped under a new name; customer_id arrives empty.
  const lookupRuns = { Lookup: { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, runs: [{ inputCount: 2, outputs: [[{ json: { id: 'C-1' }, pairedItem: { item: 0 } }, { json: { id: 'C-2' }, pairedItem: { item: 1 } }]] }] } };
  cases.push({
    id: '01-empty-id-after-field-rename',
    title: 'Mapping points at a renamed field, customer_id goes out empty',
    expect: '2 changed calls, customer_id "C-1"/"C-2" -> empty, flag empty-value',
    old: { name: 'case01', nodes: [webhook(), lookup('Lookup', [300, 0]), map('Map', [600, 0], [['email', "={{ $('Webhook').item.json.body.email }}"], ['customer_id', '={{ $json.id }}']]), push('Push', [900, 0])], connections: chain('Webhook', 'Lookup', 'Map', 'Push') },
    new: { name: 'case01', nodes: [webhook(), lookup('Lookup', [300, 0]), map('Map', [600, 0], [['email', "={{ $('Webhook').item.json.body.email }}"], ['customer_id', '={{ $json.customerId }}']]), push('Push', [900, 0])], connections: chain('Webhook', 'Lookup', 'Map', 'Push') },
    fixture: fixture(lookupRuns),
  });

  // 02: inside a loop the mapping uses .first() instead of .item; every iteration sends the first record.
  const loop: N8nNode = { parameters: { batchSize: 1, options: {} }, name: 'Loop', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [300, 0] };
  const loopConnections = (): N8nWorkflow['connections'] => ({
    Webhook: { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
    Loop: { main: [[], [{ node: 'Map', type: 'main', index: 0 }]] },
    Map: { main: [[{ node: 'Push', type: 'main', index: 0 }]] },
    Push: { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
  });
  cases.push({
    id: '02-loop-sends-first-item-n-times',
    title: 'Loop mapping switched from .item to .first(), the first record is sent for every iteration',
    expect: '1 changed call (second iteration carries the first record), flag duplicate-bodies',
    old: { name: 'case02', nodes: [webhook(), loop, map('Map', [600, 100], [['email', "={{ $('Webhook').item.json.body.email }}"], ['customer_id', "={{ $('Webhook').item.json.body.customer_id }}"]]), push('Push', [900, 100])], connections: loopConnections() },
    new: { name: 'case02', nodes: [webhook(), loop, map('Map', [600, 100], [['email', "={{ $('Webhook').first().json.body.email }}"], ['customer_id', "={{ $('Webhook').first().json.body.customer_id }}"]]), push('Push', [900, 100])], connections: loopConnections() },
    fixture: fixture(),
  });

  // 03: a Filter added on one branch makes Merge (combine by position) truncate to the shorter input.
  const merge: N8nNode = { parameters: { mode: 'combine', combineBy: 'combineByPosition', options: {} }, name: 'Merge', type: 'n8n-nodes-base.merge', typeVersion: 3, position: [900, 50] };
  const filter: N8nNode = {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: 'c1', leftValue: '={{ $json.body.customer_id }}', rightValue: 'C-1', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} },
    name: 'Only C-1',
    type: 'n8n-nodes-base.filter',
    typeVersion: 2.2,
    position: [450, 200],
  };
  cases.push({
    id: '03-merge-by-position-truncates',
    title: 'Filter on one Merge input, combine by position drops the second order',
    expect: '1 removed call (second order never sent), flag count-changed',
    old: {
      name: 'case03',
      nodes: [webhook(), map('Emails', [600, 0], [['email', '={{ $json.body.email }}']]), map('Ids', [600, 200], [['customer_id', '={{ $json.body.customer_id }}']]), merge, push('Push', [1200, 50])],
      connections: { Webhook: { main: [[{ node: 'Emails', type: 'main', index: 0 }, { node: 'Ids', type: 'main', index: 0 }]] }, Emails: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] }, Ids: { main: [[{ node: 'Merge', type: 'main', index: 1 }]] }, Merge: { main: [[{ node: 'Push', type: 'main', index: 0 }]] } },
    },
    new: {
      name: 'case03',
      nodes: [webhook(), map('Emails', [600, 0], [['email', '={{ $json.body.email }}']]), filter, map('Ids', [600, 200], [['customer_id', '={{ $json.body.customer_id }}']]), merge, push('Push', [1200, 50])],
      connections: { Webhook: { main: [[{ node: 'Emails', type: 'main', index: 0 }, { node: 'Only C-1', type: 'main', index: 0 }]] }, 'Only C-1': { main: [[{ node: 'Ids', type: 'main', index: 0 }]] }, Emails: { main: [[{ node: 'Merge', type: 'main', index: 0 }]] }, Ids: { main: [[{ node: 'Merge', type: 'main', index: 1 }]] }, Merge: { main: [[{ node: 'Push', type: 'main', index: 0 }]] } },
    },
    fixture: fixture(),
  });

  // 04: Execute Once switched on for the write node; only the first order is sent.
  const pushOnce = push('Push', [900, 0]);
  pushOnce.executeOnce = true;
  cases.push({
    id: '04-execute-once-toggled',
    title: 'Execute Once switched on for the write node, one order instead of two',
    expect: '1 removed call, flags count-changed and count-per-item-changed',
    old: { name: 'case04', nodes: [webhook(), map('Map', [600, 0], [['email', '={{ $json.body.email }}'], ['customer_id', '={{ $json.body.customer_id }}']]), push('Push', [900, 0])], connections: chain('Webhook', 'Map', 'Push') },
    new: { name: 'case04', nodes: [webhook(), map('Map', [600, 0], [['email', '={{ $json.body.email }}'], ['customer_id', '={{ $json.body.customer_id }}']]), pushOnce], connections: chain('Webhook', 'Map', 'Push') },
    fixture: fixture(),
  });

  // 05: a filter in a Code node keeps zero items; the write node never runs, the workflow ends green.
  const code = (jsCode: string): N8nNode => ({ parameters: { jsCode, mode: 'runOnceForAllItems', language: 'javaScript' }, name: 'Prepare', type: 'n8n-nodes-base.code', typeVersion: 2, position: [300, 0] });
  cases.push({
    id: '05-code-filter-drops-everything',
    title: 'Filter in a Code node keeps zero items, workflow finishes green and sends nothing',
    expect: '2 removed calls, flag node-not-executed',
    old: { name: 'case05', nodes: [webhook(), code('return $input.all().map((i) => ({ json: i.json.body }));'), push('Push', [600, 0])], connections: chain('Webhook', 'Prepare', 'Push') },
    new: { name: 'case05', nodes: [webhook(), code("return $input.all().filter((i) => i.json.body.customer_id === 'C-9').map((i) => ({ json: i.json.body }));"), push('Push', [600, 0])], connections: chain('Webhook', 'Prepare', 'Push') },
    fixture: fixture(),
  });

  // 06: no change at all, but the body carries a random nonce; only stabilisation makes it PASS.
  const nonceWorkflow = (): N8nWorkflow => ({ name: 'case06', nodes: [webhook(), map('Map', [600, 0], [['email', '={{ $json.body.email }}'], ['nonce', '={{ Math.random().toString(36).slice(2) }}']]), push('Push', [900, 0])], connections: chain('Webhook', 'Map', 'Push') });
  cases.push({
    id: '06-random-nonce-unchanged',
    title: 'Unchanged workflow with a random nonce in the body',
    expect: 'PASS after stabilisation masks body.nonce; DIFF without it',
    old: nonceWorkflow(),
    new: nonceWorkflow(),
    fixture: fixture(),
    stabilize: true,
  });

  void rl;
  return cases;
}
