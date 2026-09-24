import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, parseRulesFile, renderResponse, RuleState, ruleMatches, type Rule } from '../src/rules.ts';

const hubspot: Rule = {
  id: 'hubspot.contacts.create',
  match: { host: 'api.hubapi.com', method: 'POST', path: '^/crm/v3/objects/contacts$' },
  respond: { status: 201, json: { id: '{{seq}}', properties: '{{echo body.properties}}' } },
};
const sink: Rule = { id: 'generic-sink', match: { method: 'POST|PUT|PATCH|DELETE' }, respond: { status: 200, json: { id: 'frt-{{seq}}', ok: true } } };
const block: Rule = { id: 'block', match: {}, respond: { close: true } };

test('host match is case-insensitive and exact unless it is a regex', () => {
  assert.ok(ruleMatches(hubspot, { method: 'post', host: 'API.HUBAPI.COM', path: '/crm/v3/objects/contacts' }));
  assert.ok(!ruleMatches(hubspot, { method: 'POST', host: 'api.hubapi.com.evil', path: '/crm/v3/objects/contacts' }));
  const regex: Rule = { id: 'r', match: { host: '^.*\.googleapis\.com$' }, respond: {} };
  assert.ok(ruleMatches(regex, { method: 'GET', host: 'sheets.googleapis.com', path: '/' }));
});

test('first matching rule wins and templates render', () => {
  const state = new RuleState();
  const req = { method: 'POST', host: 'api.hubapi.com', path: '/crm/v3/objects/contacts', bodyJson: { properties: { email: 'a@b.pl' } } };
  const decision = decide([hubspot, sink, block], req, state);
  assert.equal(decision.kind, 'respond');
  if (decision.kind !== 'respond') return;
  assert.equal(decision.rule.id, 'hubspot.contacts.create');
  assert.equal(decision.response.status, 201);
  assert.equal(decision.response.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(decision.response.body), { id: '1', properties: { email: 'a@b.pl' } });
  const second = decide([hubspot, sink, block], req, state);
  if (second.kind === 'respond') assert.equal(JSON.parse(second.response.body).id, '2');
});

test('unknown host: writes hit the generic sink, reads are closed', () => {
  const state = new RuleState();
  const write = decide([hubspot, sink, block], { method: 'PUT', host: 'erp.example.com', path: '/orders/1' }, state);
  assert.equal(write.kind, 'respond');
  const read = decide([hubspot, sink, block], { method: 'GET', host: 'erp.example.com', path: '/orders/1' }, state);
  assert.equal(read.kind, 'close');
  const none = decide([hubspot, sink], { method: 'GET', host: 'erp.example.com', path: '/x' }, state);
  assert.equal(none.kind, 'none');
});

test('times consumes a rule and falls through afterwards', () => {
  const search: Rule = { id: 'search', match: { path: '^/search$' }, respond: { json: { total: 0 } }, times: 1 };
  const later: Rule = { id: 'later', match: { path: '^/search$' }, respond: { json: { total: 1 } } };
  const state = new RuleState();
  const req = { method: 'POST', host: 'h', path: '/search' };
  const first = decide([search, later], req, state);
  const second = decide([search, later], req, state);
  assert.equal(first.kind === 'respond' && first.rule.id, 'search');
  assert.equal(second.kind === 'respond' && second.rule.id, 'later');
});

test('uuid and now come from injected functions', () => {
  const rule: Rule = { id: 'x', match: {}, respond: { json: { id: '{{uuid}}', at: '{{now}}', nested: ['{{seq}}'] } } };
  const out = renderResponse(rule, { method: 'GET', host: 'h', path: '/' }, new RuleState(), { uuid: () => 'u', now: () => 't' });
  assert.deepEqual(JSON.parse(out.body), { id: 'u', at: 't', nested: ['1'] });
});

test('inline templates interpolate inside strings', () => {
  const rule: Rule = { id: 'x', match: {}, respond: { json: { id: 'frt-{{seq}}', label: 'at {{now}} for {{echo body.name}}' } } };
  const out = renderResponse(rule, { method: 'GET', host: 'h', path: '/', bodyJson: { name: 'n1' } }, new RuleState(), { now: () => 't' });
  assert.deepEqual(JSON.parse(out.body), { id: 'frt-1', label: 'at t for n1' });
});

test('parseRulesFile rejects wrong shapes', () => {
  assert.throws(() => parseRulesFile('{"schemaVersion":2,"rules":[]}'));
  assert.throws(() => parseRulesFile('{"schemaVersion":1,"rules":[{"id":"a"}]}'));
  assert.equal(parseRulesFile('{"schemaVersion":1,"rules":[]}').rules.length, 0);
});
