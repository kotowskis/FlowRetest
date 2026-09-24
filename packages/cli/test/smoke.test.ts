import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLI_VERSION } from '../src/index.ts';

test('cli exports a version', () => {
  assert.equal(typeof CLI_VERSION, 'string');
});
