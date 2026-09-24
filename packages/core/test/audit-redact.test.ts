/** Redaction regressions from the audit of weeks 1 to 8 (docs/audyt-2026-09-24.md, items 21 and 22). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Redactor, redactPlanReport, scrubText, shapeOf } from '../src/redact.ts';
import { normalizeCall } from '../src/normalize.ts';
import { diffCase } from '../src/diff.ts';
import type { CaptureRecord } from '../src/capture.ts';
import type { Fixture } from '../src/fixture.ts';

test('21: bare-digit phones, PESEL, cards, birth dates, non-ASCII names, numbers under personal keys and URL tokens are redacted', () => {
  const r = new Redactor({ salt: 'test' });
  const input = {
    phone: '601234567',
    pesel: '85031212345',
    card: '4111111111111111',
    birth_date: '1985-03-12',
    login: 'Anna1990',
    name: 'Łukasz Żółć',
    ru: 'Иван Петров',
    phoneNumber: 601234567,
    amount: 1234567,
    avatar: 'https://cdn.example.com/u/anna@firma.pl/pic.png?token=s3cr3t&size=64',
    customer_id: 'C-1',
    order: 'ORD-2026-17',
    created: '2026-09-24T10:00:00Z',
  };
  const out = r.redactValue(input) as Record<string, unknown>;
  for (const key of ['phone', 'pesel', 'card', 'birth_date', 'login', 'name', 'ru']) {
    assert.notEqual(out[key], input[key as keyof typeof input], key);
    assert.equal(String(out[key]).length, String(input[key as keyof typeof input]).length, `${key} keeps its length`);
  }
  assert.match(String(out.name), /^[A-Z][a-z]+ [A-Z][a-z]{3}$/);
  assert.match(String(out.pesel), /^\d{11}$/);
  assert.match(String(out.birth_date), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof out.phoneNumber, 'number');
  assert.notEqual(out.phoneNumber, input.phoneNumber);
  assert.equal(String(out.phoneNumber).length, 9);
  assert.equal(out.amount, 1234567, 'amounts under non-personal keys stay');
  assert.ok(!String(out.avatar).includes('s3cr3t'));
  assert.ok(!String(out.avatar).includes('anna'));
  assert.ok(String(out.avatar).startsWith('https://cdn.example.com/u/'));
  assert.equal(out.customer_id, 'C-1');
  assert.equal(out.order, 'ORD-2026-17');
  assert.equal(out.created, '2026-09-24T10:00:00Z');
  // same value, same replacement: joins between nodes survive
  assert.equal(r.redactValue({ phone: '601234567' }).phone as unknown, out.phone);
});

test('21: binary data is dropped from redacted fixtures', () => {
  const fixture: Fixture = {
    schemaVersion: 1,
    source: { workflowId: 'w', executionId: '1' },
    trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: { a: 1 }, binary: { data: { data: 'SGVsbG8=', fileName: 'umowa-kowalski.pdf' } } }] },
    nodes: {},
    redacted: false,
  };
  const out = new Redactor({ salt: 't' }).redactFixture(fixture);
  assert.equal(out.trigger.items[0]?.binary, undefined);
  assert.ok(!JSON.stringify(out).includes('kowalski'));
});

test('22: report shapes use a salted hash, keep only known placeholders and scrub the error text', () => {
  const phone = '601234567';
  const unsalted = createHash('sha256').update(phone).digest('hex').slice(0, 8);
  assert.ok(!String(shapeOf(phone, { salt: 's' })).includes(unsalted));
  assert.equal(shapeOf('<ts>', { salt: 's' }), '<ts>');
  assert.match(String(shapeOf('<p>Dear Anna Kowalska</p>', { salt: 's' })), /^<string 25 #[0-9a-f]{8}>$/);
  const scrubbed = scrubText('HubSpot: customer anna@firma.pl not found (phone 601234567, name "Anna Kowalska")', { salt: 's' });
  assert.ok(!scrubbed.includes('anna@firma.pl'));
  assert.ok(!scrubbed.includes('601234567'));
  assert.ok(!scrubbed.includes('Anna Kowalska'));
  assert.ok(scrubbed.startsWith('HubSpot: customer <string 13 #'));

  const record = (v: string, path: string): CaptureRecord => ({ ts: 1, version: v, case: '1', method: 'PATCH', host: 'h', port: 443, path, query: { tag: ['a', 'b'] }, headers: {}, bodyJson: { email: 'anna@firma.pl' }, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } });
  const d = diffCase('1', [normalizeCall(record('old', '/contacts/email/anna%40firma.pl'), { node: 'Push', runIndex: 0 })], [normalizeCall(record('new', '/contacts/email/ola%40firma.pl'), { node: 'Push', runIndex: 0 })], { newError: 'Push: "anna@firma.pl" rejected' });
  const red = redactPlanReport({ runner: '0', workflowName: 'w', engine: { image: 'i' }, oldLabel: 'o', newLabel: 'n', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true });
  const text = JSON.stringify(red);
  assert.ok(!text.includes('anna'), text);
  assert.ok(!text.includes('ola%40'), text);
  assert.equal(red.cases[0]?.entries[0]?.new?.pathValue, '/contacts/email/{email}');
});
