import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCredentialStubs, credentialStubData } from '../src/credentials.ts';

const ctx = { privateKeyPem: () => '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----' };

test('known types get the field names n8n expects', () => {
  assert.deepEqual(credentialStubData('hubspotAppToken', ctx).data, { appToken: 'frt-mock' });
  assert.equal(credentialStubData('slackApi', ctx).data.accessToken, 'xoxb-frt-mock');
  assert.equal(credentialStubData('httpHeaderAuth', ctx).data.name, 'Authorization');
  assert.equal(credentialStubData('googleApi', ctx).data.email, 'frt@frt-sandbox.iam.gserviceaccount.com');
});

test('any *OAuth2Api type gets token data with a far expiry', () => {
  const { data, known } = credentialStubData('googleSheetsOAuth2Api', ctx);
  assert.ok(known);
  const token = data.oauthTokenData as { access_token: string; expires_in: number };
  assert.equal(token.access_token, 'frt-mock');
  assert.ok(token.expires_in > 300_000_000);
});

test('unknown types produce an empty stub and are reported', () => {
  const { stubs, unknownTypes } = buildCredentialStubs(
    [
      { type: 'httpHeaderAuth', id: 'c1', name: 'ERP', node: 'Push' },
      { type: 'httpHeaderAuth', id: 'c1', name: 'ERP', node: 'Push 2' },
      { type: 'weirdApi', id: 'c2', name: 'Weird', node: 'X' },
      { type: 'notionApi', node: 'Notion' },
    ],
    ctx,
  );
  assert.equal(stubs.length, 3);
  assert.deepEqual(unknownTypes, ['weirdApi']);
  assert.equal(stubs[0]?.id, 'c1');
  assert.match(stubs[2]?.id ?? '', /^frt[0-9a-z]+$/);
});
