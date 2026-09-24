import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_VERSION, EXIT_CODES } from '../src/index.ts';

test('core exports a version and exit codes', () => {
  assert.equal(typeof CORE_VERSION, 'string');
  assert.equal(EXIT_CODES.PASS, 0);
  assert.equal(EXIT_CODES.INTERNAL, 5);
});
