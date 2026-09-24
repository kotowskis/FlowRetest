/** P2 items from the audit of weeks 1 to 8 (docs/audyt-2026-09-24.md): argument parsing and sandbox names. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byteSize, formatList, idList, positiveInt } from '../src/args.ts';
import { sandboxOf } from '../src/sandbox/session.ts';

test('sizes, counts, id lists and formats are validated instead of turning into NaN or being skipped', () => {
  assert.equal(byteSize('5mb'), 5 * 1024 * 1024);
  assert.equal(byteSize('512KB'), 512 * 1024);
  assert.equal(byteSize('1.5 MB'), Math.round(1.5 * 1024 * 1024));
  assert.equal(byteSize('5242880'), 5242880);
  assert.throws(() => byteSize('5xb'));
  assert.equal(positiveInt('10'), 10);
  assert.throws(() => positiveInt('abc'));
  assert.throws(() => positiveInt('0'));
  assert.deepEqual(idList('1, 2 ,,3'), ['1', '2', '3']);
  assert.deepEqual(formatList('terminal, junit'), ['terminal', 'junit']);
  assert.throws(() => formatList('junit,html'), /unknown format html/);
});

test('every resource of a sandbox maps to its id, so prune keeps the volume and network of a live run', () => {
  for (const name of ['frt-1a2b3c4d', 'frt-1a2b3c4d-proxy', 'frt-1a2b3c4d-n8n', 'frt-1a2b3c4d-cmd-12']) assert.equal(sandboxOf(name), 'frt-1a2b3c4d');
});
