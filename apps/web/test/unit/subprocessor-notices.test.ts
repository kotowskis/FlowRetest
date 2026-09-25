import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoticeInputSchema, changeLine, earliestEffectiveOn, noticeEmail, type Notice } from '../../lib/subprocessor-notices.ts';

const NOTICE: Notice = {
  id: 'n1',
  announced_at: '2026-09-25T10:00:00Z',
  effective_on: '2026-10-25',
  summary: 'We move email delivery from Resend to Postmark.',
  changes: [
    { action: 'add', name: 'Postmark (ActiveCampaign)', purpose: 'Email delivery', data: 'Email addresses', location: 'EU' },
    { action: 'remove', name: 'Resend Inc.', purpose: '', data: '', location: '' },
  ],
};

test('a notice can take effect 30 days after the announcement at the earliest', () => {
  assert.equal(earliestEffectiveOn(new Date('2026-09-25T23:30:00Z')), '2026-10-25');
  assert.equal(earliestEffectiveOn(new Date('2026-12-15T00:00:00Z')), '2027-01-14');
  assert.ok(NoticeInputSchema.safeParse({ effectiveOn: '2026-10-25', summary: 'x', changes: [{ action: 'add', name: 'A' }] }).success);
  assert.ok(!NoticeInputSchema.safeParse({ effectiveOn: '25.10.2026', summary: 'x', changes: [{ action: 'add', name: 'A' }] }).success);
  assert.ok(!NoticeInputSchema.safeParse({ effectiveOn: '2026-10-25', summary: 'x', changes: [] }).success);
  assert.ok(!NoticeInputSchema.safeParse({ effectiveOn: '2026-10-25', summary: 'x', changes: [{ action: 'rename', name: 'A' }] }).success);
});

test('the notice email names the date, the changes, the organizations and where to object', () => {
  const mail = noticeEmail({ to: 'owner@agency.example', organizationNames: ['Acme <Agency>', 'Beta'], notice: NOTICE, appUrl: 'https://app.example', contact: 'privacy@example.com' });
  assert.equal(mail.subject, '[FlowRetest] Sub-processor change on 2026-10-25');
  assert.equal(mail.headers?.['Reply-To'], 'privacy@example.com');
  assert.match(mail.text, /- New: Postmark \(ActiveCampaign\) \(Email delivery; data: Email addresses; location: EU\)/);
  assert.match(mail.text, /- Removed: Resend Inc\.$/m);
  assert.match(mail.text, /write to privacy@example\.com before 2026-10-25/);
  assert.match(mail.text, /https:\/\/app\.example\/legal\/subprocessors/);
  assert.match(mail.text, /owner of "Acme <Agency>", "Beta"/);
  assert.match(mail.html, /Acme &lt;Agency&gt;/);
  assert.doesNotMatch(mail.html, /<Agency>/);
  assert.ok(!mail.text.includes('\u2014'), 'no em dash');
  const plain = noticeEmail({ to: 'o@x.example', organizationNames: ['A'], notice: NOTICE, appUrl: 'https://app.example' });
  assert.equal(plain.headers, undefined);
  assert.match(plain.text, /write to us before 2026-10-25/);
  assert.equal(changeLine({ action: 'change', name: 'Supabase Inc.', purpose: '', data: '', location: 'EU (Frankfurt)' }), 'Changed: Supabase Inc. (location: EU (Frankfurt))');
});
