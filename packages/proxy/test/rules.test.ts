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
  const regex: Rule = { id: 'r', match: { host: '^.*\\.googleapis\\.com$' }, respond: {} };
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
  const first = JSON.parse(decision.response.body);
  assert.match(first.id, /^[0-9]{9}$/);
  assert.deepEqual(first.properties, { email: 'a@b.pl' });
  // the same request again in the same version gets the next number
  const second = decide([hubspot, sink, block], req, state);
  if (second.kind === 'respond') assert.equal(Number(JSON.parse(second.response.body).id), Number(first.id) + 1);
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
  const body = JSON.parse(out.body);
  assert.deepEqual({ ...body, nested: [] }, { id: 'u', at: 't', nested: [] });
  assert.match(body.nested[0], /^[0-9]{9}$/);
});

test('inline templates interpolate inside strings', () => {
  const rule: Rule = { id: 'x', match: {}, respond: { json: { id: 'frt-{{seq}}', label: 'at {{now}} for {{echo body.name}}' } } };
  const out = renderResponse(rule, { method: 'GET', host: 'h', path: '/', bodyJson: { name: 'n1' } }, new RuleState(), { now: () => 't' });
  const body = JSON.parse(out.body);
  assert.match(body.id, /^frt-[0-9]{9}$/);
  assert.equal(body.label, 'at t for n1');
});

test('seq is the n-th call to an endpoint per version: a changed body or a call elsewhere does not shift it', () => {
  const state = new RuleState();
  const idOf = (scope: string, path: string, email: string) => {
    const d = decide([hubspot, sink, block], { method: 'POST', host: 'api.hubapi.com', path, bodyJson: { properties: { email } }, scope }, state);
    return d.kind === 'respond' ? (JSON.parse(d.response.body).id as string) : '';
  };
  const oldFirst = idOf('old', '/crm/v3/objects/contacts', 'a@b.pl');
  const oldSecond = idOf('old', '/crm/v3/objects/contacts', 'c@d.pl');
  idOf('new', '/crm/v3/objects/deals', 'x'); // an extra call to another endpoint in the new version
  assert.equal(idOf('new', '/crm/v3/objects/contacts', 'a@b.pl, now changed'), oldFirst);
  assert.equal(idOf('new', '/crm/v3/objects/contacts', 'c@d.pl'), oldSecond);
  assert.notEqual(oldFirst, oldSecond);
});

test('one response renders one seq value', () => {
  const rule: Rule = { id: 'airtable', match: {}, respond: { json: { records: [{ id: 'recFRT{{seq}}' }], id: 'recFRT{{seq}}' } } };
  const body = JSON.parse(renderResponse(rule, { method: 'POST', host: 'api.airtable.com', path: '/v0/app/tbl' }, new RuleState()).body);
  assert.equal(body.records[0].id, body.id);
});

test('parseRulesFile rejects wrong shapes', () => {
  assert.throws(() => parseRulesFile('{"schemaVersion":2,"rules":[]}'));
  assert.throws(() => parseRulesFile('{"schemaVersion":1,"rules":[{"id":"a"}]}'));
  assert.equal(parseRulesFile('{"schemaVersion":1,"rules":[]}').rules.length, 0);
});
