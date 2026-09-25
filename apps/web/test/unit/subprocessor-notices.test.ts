import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DPA_VERSION, dpaDocument, isDpaLang, SUBPROCESSORS, type Block, type LegalDocument } from '../../lib/legal/documents.ts';
import { provider } from '../../lib/legal/provider.ts';
import { renderDpaRecord } from '../../lib/pdf/dpa-pdf.ts';
import { NoticeInputSchema, changeLine, earliestEffectiveOn, noticeEmail, type Notice } from '../../lib/subprocessor-notices.ts';

const P = provider({ LEGAL_NAME: 'Skynappse Sp. z o.o.', LEGAL_ADDRESS: 'ul. Testowa 1, 00-001 Warszawa', LEGAL_COMPANY_ID: 'NIP PL0000000000', LEGAL_EMAIL: 'privacy@example.com', LEGAL_FINAL: 'true' });

function shape(doc: LegalDocument): unknown {
  return doc.sections.map((s) => s.blocks.map((b) => ('p' in b ? 'p' : 'ul' in b ? ['ul', b.ul.length] : ['table', b.table.head.length, b.table.rows.length])));
}

function strings(doc: LegalDocument): string[] {
  const of = (b: Block) => ('p' in b ? [b.p] : 'ul' in b ? b.ul : [...b.table.head, ...b.table.rows.flat()]);
  return [doc.title, doc.summary, ...doc.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(of)])];
}

test('the Polish DPA has the same sections and blocks as the English one, in the same order', () => {
  const en = dpaDocument(DPA_VERSION, P, 'en')!;
  const pl = dpaDocument(DPA_VERSION, P, 'pl')!;
  assert.equal(pl.version, en.version);
  assert.equal(pl.title, 'Umowa powierzenia przetwarzania danych osobowych');
  assert.deepEqual(shape(pl), shape(en));
  // Section numbers match, so "section 6" means the same clause in both languages.
  assert.deepEqual(pl.sections.map((s) => s.heading.match(/^\d+/)?.[0] ?? ''), en.sections.map((s) => s.heading.match(/^\d+/)?.[0] ?? ''));
  const all = strings(pl);
  assert.ok(all.some((t) => t.includes('Skynappse Sp. z o.o.')));
  assert.ok(all.some((t) => t.includes('privacy@example.com')));
  for (const s of SUBPROCESSORS) assert.ok(all.includes(s.pl.purpose), `annex 3 has ${s.name} in Polish`);
  assert.ok(all.some((t) => /rozstrzyga wersja angielska/.test(t)));
  assert.ok(strings(en).some((t) => /English version prevails/.test(t)));
  assert.equal(isDpaLang('pl'), true);
  assert.equal(isDpaLang('de'), false);
  assert.equal(isDpaLang(undefined), false);
});

test('the Polish DPA passes the AI marker rules that apply to Polish text', () => {
  // The rules of the ai-markers filter (pstryk voice-profile): no em dash, no "nie tylko ... ale", no triple of words.
  const triple = /(?<![\p{L}\p{N}])(\p{Ll}{4,}),\s+(\p{Ll}{4,})\s+i\s+(\p{Ll}{4,})(?![\p{L}\p{N}])/u;
  for (const t of strings(dpaDocument(DPA_VERSION, P, 'pl')!)) {
    assert.ok(!t.includes('\u2014'), `em dash in "${t.slice(0, 60)}"`);
    assert.ok(!/nie tylko[^.]*ale/i.test(t), `"nie tylko ... ale" in "${t.slice(0, 60)}"`);
    assert.ok(!triple.test(t), `triple in "${t.match(triple)?.[0]}"`);
  }
});

test('the Polish DPA copy renders, labels in Polish', async () => {
  const pdf = await renderDpaRecord({
    doc: dpaDocument(DPA_VERSION, P, 'pl')!,
    provider: P,
    acceptance: { id: '00000000-0000-0000-0000-000000000002', organizationName: 'Agencja Żółw', companyName: 'Żółw Sp. z o.o.', companyAddress: 'ul. Świętokrzyska 1, Warszawa', companyId: null, signerName: 'Łucja Żółkiewska', signerRole: 'Prezes zarządu', signerEmail: 'lucja@zolw.example', acceptedAt: '2026-09-25 12:00 UTC' },
    printedAt: '2026-09-25 12:05 UTC',
    lang: 'pl',
  });
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0) >= 3);
  if (process.env.DPA_PL_OUT) writeFileSync(process.env.DPA_PL_OUT, pdf);
});

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
  assert.ok(!mail.text.includes('\u2014'));
  const plain = noticeEmail({ to: 'o@x.example', organizationNames: ['A'], notice: NOTICE, appUrl: 'https://app.example' });
  assert.equal(plain.headers, undefined);
  assert.match(plain.text, /write to us before 2026-10-25/);
  assert.equal(changeLine({ action: 'change', name: 'Supabase Inc.', purpose: '', data: '', location: 'EU (Frankfurt)' }), 'Changed: Supabase Inc. (location: EU (Frankfurt))');
});
