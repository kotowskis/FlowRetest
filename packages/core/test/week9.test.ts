/** Week 9: what the hosted layer accepts. A redacted report passes the guard; the original does not. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasPersonal, redactPlanReport, redactionProblems, scrubPersonal } from '../src/redact.ts';
import { normalizeCall } from '../src/normalize.ts';
import { diffCase } from '../src/diff.ts';
import type { CaptureRecord } from '../src/capture.ts';
import type { PlanReport } from '../src/render.ts';

function record(version: string, body: unknown, path = '/v1/sms'): CaptureRecord {
  return { ts: 1, version, case: '7', method: 'POST', host: 'api.sms.example', port: 443, path, query: { to: '601234567' }, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'abc', multipart: undefined, rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
}

function report(): PlanReport {
  const d = diffCase(
    '7',
    [normalizeCall(record('old', { phone: '601234567', amount: 10, tags: ['vip'] }, '/v1/contacts/1717171/sms'), { node: 'Send', runIndex: 0 })],
    [normalizeCall(record('new', { phone: '', amount: 12, tags: ['vip'] }, '/v1/contacts/1717171/sms'), { node: 'Send', runIndex: 0 })],
  );
  return { runner: '0', workflowName: 'w', workflowId: 'wf1', engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'o', newLabel: 'n', cases: [d], coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: [] }, sealed: true };
}

test('a report straight from the run is refused, its redacted copy is accepted', () => {
  const plain = report();
  const problems = redactionProblems(plain);
  assert.ok(problems.some((p) => p.includes('body.phone')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('query.to')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('concrete path')), problems.join('\n'));
  assert.deepEqual(redactionProblems(redactPlanReport(plain)), []);
});

test('numbers and booleans stay in a redacted report, strings in field diffs must be shapes', () => {
  const red = redactPlanReport(report());
  const entry = red.cases[0]?.entries[0];
  assert.equal((entry?.new?.body as { amount: number }).amount, 12);
  const tampered: PlanReport = { ...red, cases: red.cases.map((c) => ({ ...c, entries: c.entries.map((e) => ({ ...e, fieldDiffs: [{ path: 'phone', old: '601234567', new: '<string 0 #00000000>' }] })) })) };
  assert.deepEqual(redactionProblems(tampered), ['case 7 entry 1 field phone (old): value is not redacted']);
});

test('the body hash in a redacted report is salted: equal inside one report, different across salts', () => {
  const plain = report();
  const a = redactPlanReport(plain, { salt: 'a' });
  const b = redactPlanReport(plain, { salt: 'b' });
  const hash = (r: PlanReport) => r.cases[0]?.entries[0]?.old?.bodyHash;
  assert.notEqual(hash(a), plain.cases[0]?.entries[0]?.old?.bodyHash);
  assert.notEqual(hash(a), hash(b));
  assert.equal(hash(a), hash(redactPlanReport(plain, { salt: 'a' })));
});

/** A report whose calls carry values outside string leaves: numbers, keys, path segments, free text. */
function leakyReport(): PlanReport {
  const rec = (version: string, note: string): CaptureRecord => ({
    ts: 1,
    version,
    case: '3',
    method: 'POST',
    host: 'crm.example.com',
    port: 443,
    path: '/customers/Anna%20Kowalska/phone/+48600123456',
    query: { 'jan@firma.pl': 'x' },
    headers: {},
    bodyJson: { pesel: 90010112345, amount: 12, contacts: { 'anna@firma.pl': { note } } },
    bodyBytes: 1,
    bodySha256: 'abc',
    multipart: undefined,
    rule: { id: 'generic-sink', kind: 'generic-sink' },
    response: { status: 200 },
  });
  const d = diffCase('3', [normalizeCall(rec('old', 'a'), { node: 'Call 600 700 800', runIndex: 0 })], [normalizeCall(rec('new', 'b'), { node: 'Call 600 700 800', runIndex: 0 })], {
    newError: 'customer Anna (+48 600 100 200) not found',
  });
  return {
    runner: '0.3.0',
    workflowName: 'Leads for anna@firma.pl',
    workflowId: 'wf3',
    engine: { image: 'n8nio/n8n:2.40.5' },
    oldLabel: 'recorded',
    newLabel: 'ola@firma.pl.json',
    cases: [{ ...d, warnings: ['node "Call 600 700 800" replayed'] }],
    coverage: { writeNodesTotal: 1, writeNodesCaptured: 1, replayedNodes: 0, unsupported: ['SMS to 600700800'] },
    sealed: true,
  };
}

test('numbers from a million up, keys, path segments and free text lose emails and long numbers', () => {
  const red = redactPlanReport(leakyReport(), { salt: 's' });
  const json = JSON.stringify(red);
  for (const leak of ['90010112345', 'anna@firma.pl', 'jan@firma.pl', 'ola@firma.pl', 'Kowalska', '600123456', '600 100 200', '600 700 800', '600700800']) {
    assert.ok(!json.includes(leak), `${leak} left in the redacted report`);
  }
  const call = red.cases[0]?.entries[0]?.new;
  assert.equal((call?.body as { amount: number }).amount, 12, 'small numbers stay readable');
  assert.equal((call?.body as { pesel: string }).pesel, '<digits 11>');
  assert.match(call?.pathTemplate ?? '', /^\/customers\/<string 13 #[0-9a-f]{8}>\/phone\/<string 12 #[0-9a-f]{8}>$/);
  assert.equal(red.cases[0]?.entries[0]?.pathTemplate, call?.pathTemplate);
  assert.deepEqual(redactionProblems(red), []);
});

test('the guard finds values outside string leaves in a report that was not redacted', () => {
  const problems = redactionProblems(leakyReport(), 100).join('\n');
  for (const where of ['workflowName', 'newLabel', 'coverage', 'case 3 error', 'case 3 message', 'entry 1 node', 'entry 1 path: segment', 'new.body.pesel', 'new.body.contacts key', 'new.query key']) {
    assert.ok(problems.includes(where), `${where} not reported:\n${problems}`);
  }
  const red = redactPlanReport(leakyReport());
  const tampered: PlanReport = { ...red, cases: red.cases.map((c) => ({ ...c, entries: c.entries.map((e) => ({ ...e, fieldDiffs: [{ path: 'pesel', old: 90010112345, new: 12 }] })) })) };
  assert.deepEqual(redactionProblems(tampered), ['case 3 entry 1 field pesel (old): value is not redacted']);
});

test('scrubbing twice changes nothing, dates of four digits and version numbers stay', () => {
  const salt = { salt: 's' };
  const once = scrubPersonal('Report 2026 v2.40.5 for anna@firma.pl, call +48 600 100 200', salt);
  assert.equal(once, scrubPersonal(once, salt));
  assert.match(once, /^Report 2026 v2\.40\.5 for <string 13 #[0-9a-f]{8}>, call <digits 11>$/);
  assert.equal(hasPersonal(once), false);
});
