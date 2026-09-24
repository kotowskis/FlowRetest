import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStubs, parseStubFlag, stubItems } from '../src/stubs.ts';

test('--stub splits at the last = so node names may contain one', () => {
  assert.deepEqual(parseStubFlag('a=b=stubs/x.json'), { node: 'a=b', file: 'stubs/x.json' });
  assert.throws(() => parseStubFlag('no-file'));
  assert.throws(() => parseStubFlag('=x.json'));
});

test('stub content: an array, an object with items, or one item', () => {
  assert.deepEqual(stubItems([{ a: 1 }], 'x'), [{ a: 1 }]);
  assert.deepEqual(stubItems({ items: [{ a: 1 }, { a: 2 }] }, 'x'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(stubItems({ a: 1 }, 'x'), [{ a: 1 }]);
  assert.throws(() => stubItems('text', 'x'));
});

test('stubs.yml with inline items and files; a --stub flag wins for the same node', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'frt-stubs-'));
  try {
    const dir = join(cwd, '.flowretest', 'w1');
    mkdirSync(join(dir, 'stubs'), { recursive: true });
    writeFileSync(join(dir, 'stubs', 'lookup.yml'), '- name: Anna\n  tier: gold\n');
    writeFileSync(join(dir, 'stubs.yml'), 'schemaVersion: 1\nstubs:\n  Upsert order:\n    items:\n      - id: 42\n  Lookup:\n    file: stubs/lookup.yml\n');
    writeFileSync(join(cwd, 'override.json'), JSON.stringify({ items: [{ id: 7 }] }));
    const stubs = loadStubs(cwd, 'w1', ['Upsert order=override.json']);
    assert.deepEqual(stubs.Lookup, { items: [{ name: 'Anna', tier: 'gold' }], source: 'stubs.yml (stubs/lookup.yml)' });
    assert.deepEqual(stubs['Upsert order'], { items: [{ id: 7 }], source: '--stub override.json' });
    writeFileSync(join(dir, 'stubs.yml'), 'schemaVersion: 1\nstubs:\n  Bad:\n    items: 3\n');
    assert.throws(() => loadStubs(cwd, 'w1'), /stubs\.yml/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the sandbox section is sealed only when every check of every sandbox passed', async () => {
  const { sandboxSection } = await import('../src/commands/run.ts');
  const ok = { sealed: true, network: 'frt-1', checks: [{ name: 'internal network', ok: true, detail: 'Internal=true' }] };
  const leak = { sealed: false, network: 'frt-2', checks: [{ name: 'direct connection without proxy', ok: false, detail: 'reached example.com' }] };
  assert.equal(sandboxSection([ok]).sealed, true);
  assert.equal(sandboxSection([ok, leak]).sealed, false);
  assert.equal(sandboxSection([]).sealed, false);
  assert.deepEqual(sandboxSection([leak]).checks[0], { network: 'frt-2', name: 'direct connection without proxy', ok: false, detail: 'reached example.com' });
});
