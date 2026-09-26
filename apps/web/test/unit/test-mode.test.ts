/** Test mode (ADR 0019): the flag counts only on the local stack, and test mode never mails through Resend. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { sendMail } from '../../lib/mail.ts';
import { isTestAccount, testMode, testModeProblem, TEST_ACCOUNTS } from '../../lib/test-mode.ts';

const local = { FLOWRETEST_TEST_MODE: 'true', APP_URL: 'http://127.0.0.1:3100', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' };

test('the flag turns test mode on only when the app and the database are on localhost', () => {
  assert.equal(testMode(local), true);
  assert.equal(testMode({ ...local, APP_URL: 'http://localhost:3101/' }), true);
  assert.equal(testMode({ ...local, APP_URL: undefined }), true, 'APP_URL defaults to 127.0.0.1:3100');
  assert.equal(testMode({ ...local, FLOWRETEST_TEST_MODE: '1' }), false);
  assert.equal(testMode({ ...local, FLOWRETEST_TEST_MODE: undefined }), false);
  assert.equal(testModeProblem({ ...local, FLOWRETEST_TEST_MODE: undefined }), undefined, 'no flag, nothing to report');

  const publicApp = { ...local, APP_URL: 'https://app.flowretest.com' };
  assert.equal(testMode(publicApp), false);
  assert.match(testModeProblem(publicApp) ?? '', /APP_URL https:\/\/app\.flowretest\.com is not on localhost/);
  const hostedDb = { ...local, NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co' };
  assert.equal(testMode(hostedDb), false);
  assert.match(testModeProblem(hostedDb) ?? '', /NEXT_PUBLIC_SUPABASE_URL/);
  assert.equal(testMode({ ...local, NEXT_PUBLIC_SUPABASE_URL: undefined }), false);
  assert.equal(testMode({ ...local, APP_URL: 'http://127.0.0.1.evil.test:3100' }), false);
});

test('only the seeded addresses get the one-click sign-in', () => {
  assert.equal(TEST_ACCOUNTS.length, 4);
  for (const a of TEST_ACCOUNTS) {
    assert.equal(isTestAccount(a.email), true);
    assert.match(a.email, /\.test$/, 'reserved TLD: no real mailbox can own a test account');
  }
  assert.equal(isTestAccount('someone@acme-agency.test'), false);
  assert.equal(isTestAccount('OWNER@acme-agency.test'), false);
});

test('in test mode mail goes to Mailpit even with a Resend key in the environment', async () => {
  const received: string[] = [];
  const server = createServer((req, res) => {
    received.push(req.url ?? '');
    req.resume();
    req.on('end', () => res.writeHead(200).end('{}'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const mailpit = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const message = { to: 'owner@acme-agency.test', subject: 'Run DIFF', text: 't', html: '<p>t</p>' };
    const r = await sendMail(message, { ...local, RESEND_API_KEY: 're_live_key', MAILPIT_URL: mailpit });
    assert.equal(r.transport, 'mailpit');
    assert.deepEqual(received, ['/api/v1/send']);
  } finally {
    server.close();
  }
});
