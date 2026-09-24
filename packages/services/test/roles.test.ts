import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceRole } from '../src/roles.ts';
import { serviceRules } from '../src/sinks.ts';

const node = (type: string, parameters: Record<string, unknown>) => ({ name: 'n', type, typeVersion: 1, position: [0, 0] as [number, number], parameters });

test('service roles come from resource and operation with defaults', () => {
  assert.equal(serviceRole(node('n8n-nodes-base.slack', { resource: 'message', operation: 'post' }))?.role, 'write');
  assert.equal(serviceRole(node('n8n-nodes-base.slack', { resource: 'channel', operation: 'getAll' }))?.role, 'read');
  assert.equal(serviceRole(node('n8n-nodes-base.hubspot', {}))?.role, 'write');
  assert.equal(serviceRole(node('n8n-nodes-base.googleSheets', { operation: 'read' }))?.role, 'read');
  assert.equal(serviceRole(node('n8n-nodes-base.googleSheets', { operation: 'append' }))?.role, 'write');
  assert.equal(serviceRole(node('n8n-nodes-base.notion', { resource: 'databasePage', operation: 'create' }))?.role, 'write');
  assert.equal(serviceRole(node('n8n-nodes-base.slack', { resource: 'message', operation: 'nope' }))?.role, 'unsupported');
  assert.equal(serviceRole(node('n8n-nodes-base.slack', { resource: 'message', operation: '={{ $json.op }}' }))?.role, 'write');
  assert.equal(serviceRole(node('n8n-nodes-base.postgres', { operation: 'select' }))?.role, 'read');
  assert.equal(serviceRole(node('n8n-nodes-base.postgres', { operation: 'insert' }))?.role, 'unsupported');
  assert.match(serviceRole(node('n8n-nodes-base.postgres', { operation: 'insert' }))?.note ?? '', /database write/);
  assert.equal(serviceRole(node('n8n-nodes-base.mongoDb', {})), undefined);
});

test('service rules have unique ids and end with the token rule', () => {
  const rules = serviceRules();
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[ids.length - 1], 'token');
});
