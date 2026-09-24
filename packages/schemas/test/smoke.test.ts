import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION } from '../src/index.ts';

test('schemas export a schema version', () => {
  assert.equal(SCHEMA_VERSION, 1);
});
