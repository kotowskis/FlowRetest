import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiValues, parseJsonExact } from '../src/server.ts';

test('repeated query and form keys keep every value in order', () => {
  assert.deepEqual(multiValues(new URLSearchParams('tag=a&tag=b&x=1')), { tag: ['a', 'b'], x: '1' });
  assert.deepEqual(multiValues(new URLSearchParams('')), {});
});

test('integers beyond 2^53 keep their exact digits', () => {
  const parsed = parseJsonExact('{"id":1234567890123456789,"n":42,"f":1.5,"nested":[9007199254740993]}') as Record<string, unknown>;
  assert.equal(parsed.id, '1234567890123456789');
  assert.equal(parsed.n, 42);
  assert.equal(parsed.f, 1.5);
  assert.deepEqual(parsed.nested, ['9007199254740993']);
  assert.notDeepEqual(parseJsonExact('{"id":1234567890123456789}'), parseJsonExact('{"id":1234567890123456788}'));
});
