import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema, FixtureSchema, RulesFileSchema, jsonSchemaOf, parseOrThrow } from '../src/index.ts';

test('config schema accepts the documented shape and rejects a wrong version', () => {
  const ok = parseOrThrow(ConfigSchema, { schemaVersion: 1, instance: { url: 'https://n8n.example.com' }, engine: { image: 'n8nio/n8n', tag: '2.40.5', timezone: 'UTC' }, proxy: { image: 'flowretest-proxy:dev' }, normalize: { ignore: [] }, run: { timeoutSeconds: 120, stabilize: false } }, 'config');
  assert.equal(ok.engine.tag, '2.40.5');
  assert.throws(() => parseOrThrow(ConfigSchema, { schemaVersion: 2 }, 'config'), /config is not valid: schemaVersion/);
});

test('fixture and rules schemas validate minimal documents', () => {
  const fixture = parseOrThrow(FixtureSchema, { schemaVersion: 1, source: { workflowId: 'w', executionId: '1' }, trigger: { node: 'Webhook', type: 't', typeVersion: 2, items: [{ json: {} }] }, nodes: {}, redacted: false }, 'fixture');
  assert.equal(fixture.trigger.items.length, 1);
  const rules = parseOrThrow(RulesFileSchema, { schemaVersion: 1, rules: [{ id: 'block', match: {}, respond: { close: true } }] }, 'rules');
  assert.equal(rules.rules[0]?.id, 'block');
});

test('JSON Schema export works for every format', () => {
  for (const name of ['config', 'fixture', 'rules', 'capture', 'report', 'baseline'] as const) {
    const schema = jsonSchemaOf(name);
    assert.equal(schema.type, 'object', name);
  }
});
