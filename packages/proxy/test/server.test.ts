import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProxy, CA_CERT_FILE, CA_KEY_FILE } from '../src/server.ts';

test('proxy answers from rules, closes blocked requests and writes capture lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frt-proxy-'));
  const rulesPath = join(dir, 'rules.json');
  const captureDir = join(dir, 'capture');
  const caDir = join(dir, 'ca');
  writeFileSync(
    rulesPath,
    JSON.stringify({
      schemaVersion: 1,
      rules: [
        { id: 'generic-sink', match: { method: 'POST|PUT|PATCH|DELETE' }, respond: { status: 200, json: { id: 'frt-{{seq}}', echo: '{{echo body.name}}' } } },
        { id: 'block', match: {}, respond: { close: true } },
      ],
    }),
  );
  const server = await startProxy({ port: 0, rulesPath, captureDir, caDir, maxStoredBody: 1024 });
  try {
    assert.ok(existsSync(join(caDir, CA_CERT_FILE)));
    assert.ok(existsSync(join(caDir, CA_KEY_FILE)));

    writeFileSync(join(captureDir, 'current.json'), JSON.stringify({ version: 'new', case: '04' }));
    const res = await fetch(`http://127.0.0.1:${server.port}/api/orders?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ name: 'order-1' }),
    });
    assert.equal(res.status, 200);
    const answer = (await res.json()) as { id: string; echo: string };
    assert.match(answer.id, /^frt-[0-9]{9}$/);
    assert.equal(answer.echo, 'order-1');

    await assert.rejects(fetch(`http://127.0.0.1:${server.port}/api/orders/1`), /fetch failed/);

    const lines = readFileSync(join(captureDir, 'requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    const [post, get] = lines;
    assert.equal(post.version, 'new');
    assert.equal(post.case, '04');
    assert.equal(post.method, 'POST');
    assert.equal(post.path, '/api/orders');
    assert.deepEqual(post.query, { x: '1' });
    assert.deepEqual(post.bodyJson, { name: 'order-1' });
    assert.equal(post.headers['x-frt-has-authorization'], 'true');
    assert.equal(post.headers.authorization, undefined);
    assert.equal(post.rule.kind, 'generic-sink');
    assert.equal(post.response.status, 200);
    assert.equal(get.method, 'GET');
    assert.equal(get.rule.id, 'block');
    assert.equal(get.response.status, 'close');
  } finally {
    await server.stop();
  }
});
