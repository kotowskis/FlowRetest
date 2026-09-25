/** P2 fixes of docs/audyt-2026-09-25.md that need no database: Slack triggers, mail headers, file names, CSP. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { validateSlackWebhook } from '../../lib/slack.ts';
import { runEmail } from '../../lib/notify.ts';
import { sendMail } from '../../lib/mail.ts';
import { recordFileNameUtf8 } from '../../lib/run-record.ts';
import { contentSecurityPolicy } from '../../lib/csp.ts';

test('Slack Workflow Builder webhook triggers are accepted next to incoming webhooks; other paths are not', () => {
  assert.equal(validateSlackWebhook('https://hooks.slack.com/triggers/T0123/4567890123/abcdef0123456789', '').ok, true);
  assert.equal(validateSlackWebhook('https://hooks.slack.com/services/T1/B2/secret', '').ok, true);
  assert.equal(validateSlackWebhook('https://hooks.slack.com/triggers/T0123/not-a-number/abc', '').ok, false);
  assert.equal(validateSlackWebhook('https://hooks.slack.com/api/chat.postMessage', '').ok, false);
});

test('run emails name the settings page as List-Unsubscribe, and a line break in a name never reaches a header', async () => {
  const m = runEmail({ to: 'a@agency.test', status: 'DIFF', mode: 'change', workflowName: 'Leads\r\nBcc: x@evil.test', workspaceName: 'Acme', summary: { cases: 1, PASS: 0, DIFF: 1, ERROR: 0, BLOCKED: 0, SKIPPED: 0, changed: 1, added: 0, removed: 0, blocked: 0 }, url: 'https://app.example/runs/1', settingsUrl: 'https://app.example/w/2#notifications' });
  assert.equal(m.headers?.['List-Unsubscribe'], '<https://app.example/w/2#notifications>');
  let received: { Subject?: string; Headers?: Record<string, string> } = {};
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ID":"1"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const result = await sendMail(m, { MAILPIT_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    assert.equal(result.ok, true);
    assert.ok(!/[\r\n]/.test(received.Subject ?? ''), JSON.stringify(received.Subject));
    assert.equal(received.Headers?.['List-Unsubscribe'], '<https://app.example/w/2#notifications>');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('the UTF-8 file name keeps the workflow name and drops separators, quotes and control characters', () => {
  assert.equal(recordFileNameUtf8('Wyślij "leady" / Łódź\n', 'DIFF', '2026-09-25T10:00:00Z'), 'flowretest-Wyślij leady  Łódź-2026-09-25-diff.pdf');
  assert.equal(recordFileNameUtf8('\\', 'PASS', '2026-09-25'), 'flowretest-workflow-2026-09-25-pass.pdf');
});

test('page CSP: scripts only with the nonce, eval only in development, no framing', () => {
  const prod = contentSecurityPolicy('abc', false);
  assert.match(prod, /script-src 'self' 'nonce-abc' 'strict-dynamic';/);
  assert.ok(!prod.includes('unsafe-eval') && !/script-src[^;]*unsafe-inline/.test(prod));
  assert.match(prod, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy('abc', true), /'unsafe-eval'/);
});
