/** CLI regressions from the audit of weeks 1 to 8 (docs/audyt-2026-09-24.md, items 18 and 19). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, defaultProxyImage } from '../src/config.ts';
import { mergeConfig } from '../src/commands/init.ts';
import { hostUserArgs } from '../src/sandbox/session.ts';

test('19: init keeps the committed settings and refreshes only instance, engine and a managed proxy image', () => {
  const existing = defaultConfig('http://old:5678', '2.30.0', 'Europe/Warsaw');
  existing.normalize.ignore = ['properties.last_activity'];
  existing.run = { timeoutSeconds: 300, stabilize: true, executor: 'execute' };
  existing.engine.env = { N8N_DEFAULT_LOCALE: 'pl' };
  existing.proxy.image = 'ghcr.io/skynappse/flowretest-proxy@sha256:' + 'a'.repeat(64);
  const merged = mergeConfig(existing, defaultConfig('http://new:5678', '2.40.5', 'UTC'), false);
  assert.equal(merged.instance.url, 'http://new:5678');
  assert.equal(merged.engine.tag, '2.40.5');
  assert.equal(merged.engine.timezone, 'Europe/Warsaw');
  assert.deepEqual(merged.engine.env, { N8N_DEFAULT_LOCALE: 'pl' });
  assert.deepEqual(merged.normalize.ignore, ['properties.last_activity']);
  assert.deepEqual(merged.run, { timeoutSeconds: 300, stabilize: true, executor: 'execute' });
  assert.equal(merged.proxy.image, defaultProxyImage());
  const custom = mergeConfig({ ...existing, proxy: { image: 'registry.local/my-proxy:1' } }, defaultConfig('http://new:5678', '2.40.5', 'UTC'), true);
  assert.equal(custom.proxy.image, 'registry.local/my-proxy:1');
  assert.equal(custom.engine.timezone, 'UTC');
});

test('18: on Linux the proxy runs as the host user, elsewhere Docker Desktop maps ownership itself', () => {
  assert.deepEqual(hostUserArgs('linux', 1001, 118), ['--user', '1001:118']);
  assert.deepEqual(hostUserArgs('linux', 0, 0), []);
  assert.deepEqual(hostUserArgs('win32', 1000, 1000), []);
  assert.deepEqual(hostUserArgs('darwin', 501, 20), []);
});
