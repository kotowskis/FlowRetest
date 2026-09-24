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

test('left-out resource and operation mean the n8n default, not the first table entry', () => {
  const v = (type: string, typeVersion: number, parameters: Record<string, unknown>) => serviceRole({ ...node(type, parameters), typeVersion });
  // Postgres and MySQL v2 default to insert: a database write, never a replayed select.
  assert.equal(v('n8n-nodes-base.postgres', 2.6, {})?.role, 'unsupported');
  assert.equal(v('n8n-nodes-base.mySql', 2.5, {})?.role, 'unsupported');
  assert.equal(v('n8n-nodes-base.postgres', 1, {})?.role, 'unsupported');
  // Google Sheets defaults to read, Airtable to get: replayed reads, not writes run against the sink.
  assert.equal(v('n8n-nodes-base.googleSheets', 4.7, {})?.role, 'read');
  assert.equal(v('n8n-nodes-base.airtable', 2.2, {})?.role, 'read');
  assert.equal(v('n8n-nodes-base.airtable', 1, {})?.role, 'read');
  assert.equal(v('n8n-nodes-base.airtable', 1, { operation: 'append' })?.role, 'write');
  // HubSpot v1 defaults to the deal resource.
  assert.equal(v('n8n-nodes-base.hubspot', 1, { operation: 'getAll' })?.role, 'read');
  assert.equal(v('n8n-nodes-base.hubspot', 1, { operation: 'upsert' })?.role, 'unsupported');
  // Slack v2 user operations are info and lookupByEmail, not get.
  assert.equal(v('n8n-nodes-base.slack', 2.3, { resource: 'user' })?.role, 'read');
  assert.equal(v('n8n-nodes-base.slack', 2.3, { resource: 'user', operation: 'lookupByEmail' })?.role, 'read');
  assert.equal(v('n8n-nodes-base.notion', 3, { resource: 'page', operation: 'updateMarkdown' })?.role, 'write');
  assert.equal(v('n8n-nodes-base.slack', 2.3, { resource: '={{ $json.r }}' })?.role, 'write');
});

test('service rules have unique ids and end with the token rule', () => {
  const rules = serviceRules();
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[ids.length - 1], 'token');
});
