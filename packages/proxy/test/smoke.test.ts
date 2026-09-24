import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROXY_VERSION } from '../src/index.ts';

test('proxy exports a version', () => {
  assert.equal(typeof PROXY_VERSION, 'string');
});
