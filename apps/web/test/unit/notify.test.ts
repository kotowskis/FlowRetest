import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runEmail } from '../../lib/notify.ts';
import { sendMail } from '../../lib/mail.ts';

const summary = { cases: 3, PASS: 1, DIFF: 1, ERROR: 1, BLOCKED: 0, SKIPPED: 0, changed: 2, added: 0, removed: 1, blocked: 0 };

test('the run email has status, counts and the link, and escapes names in HTML', () => {
  const m = runEmail({ to: 'a@agency.test', status: 'ERROR', mode: 'change', workflowName: 'Leads <script>', workspaceName: 'Acme & Co', summary, url: 'https://app.example/runs/1', settingsUrl: 'https://app.example/w/2#notifications' });
  assert.equal(m.subject, '[FlowRetest] ERROR: Leads <script> (Acme & Co)');
  assert.match(m.text, /Cases: 3 cases \(1 DIFF, 1 ERROR, 1 PASS\)/);
  assert.match(m.text, /Calls: 2 changed, 1 removed/);
  assert.match(m.text, /https:\/\/app\.example\/runs\/1/);
  assert.ok(m.html.includes('Leads &lt;script&gt;'));
  assert.ok(m.html.includes('Acme &amp; Co'));
  assert.ok(!m.html.includes('<script>'));
});

test('mail goes to Mailpit when MAILPIT_URL is set, to the log without a transport', async () => {
  let received: { From: { Email: string; Name: string }; To: Array<{ Email: string }>; Subject: string } | undefined;
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ID":"x"}');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  try {
    const message = { to: 'a@agency.test', subject: 's', text: 't', html: 'h' };
    const r = await sendMail(message, { MAILPIT_URL: `http://127.0.0.1:${port}/`, MAIL_FROM: 'Ops <ops@agency.test>' });
    assert.deepEqual(r, { ok: true, transport: 'mailpit', detail: '{"ID":"x"}' });
    assert.deepEqual(received?.From, { Email: 'ops@agency.test', Name: 'Ops' });
    assert.equal(received?.To[0]?.Email, 'a@agency.test');
    const logged = await sendMail(message, {});
    assert.equal(logged.transport, 'log');
    const down = await sendMail(message, { MAILPIT_URL: 'http://127.0.0.1:1' });
    assert.equal(down.ok, false);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
});
