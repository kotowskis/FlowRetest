import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from '../src/index.ts';

test('services list is an array', () => {
  assert.ok(Array.isArray(SERVICES));
});
