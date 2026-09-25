import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DPA_VERSION, LEGAL_SLUGS, RETENTION_ROWS, SUBPROCESSORS, dpaAcceptanceOpen, dpaDocument, legalDocument, type Block } from '../../lib/legal/documents.ts';
import { contactEmail, provider } from '../../lib/legal/provider.ts';
import { accountDeletionPlan } from '../../lib/account.ts';
import { exportFileName, exportLine } from '../../lib/export.ts';
import { renderDpaRecord } from '../../lib/pdf/dpa-pdf.ts';

const COMPANY = { LEGAL_NAME: 'Skynappse Sp. z o.o.', LEGAL_ADDRESS: 'ul. Testowa 1, 00-001 Warszawa', LEGAL_COMPANY_ID: 'KRS 0000000000, NIP PL0000000000', LEGAL_EMAIL: 'privacy@example.com' };

test('the provider stays a draft until every company detail is set and LEGAL_FINAL says so', () => {
  assert.equal(provider({}).draft, true);
  assert.equal(provider({}).name, '[company name]');
  assert.equal(provider(COMPANY).draft, true, 'details alone do not finish the texts');
  const final = provider({ ...COMPANY, LEGAL_FINAL: 'true' });
  assert.equal(final.draft, false);
  assert.equal(final.email, 'privacy@example.com');
  assert.equal(provider({ ...COMPANY, LEGAL_EMAIL: ' ', LEGAL_FINAL: 'true' }).draft, true);
  assert.equal(dpaAcceptanceOpen(provider({})), false, 'nobody accepts a draft in production');
  assert.equal(dpaAcceptanceOpen(provider({}), { LEGAL_ALLOW_DRAFT_ACCEPTANCE: 'true' }), true);
  assert.equal(dpaAcceptanceOpen(final, {}), true);
  assert.equal(contactEmail({ SALES_EMAIL: 'hello@example.com', LEGAL_EMAIL: 'privacy@example.com' }), 'hello@example.com');
  assert.equal(contactEmail({ LEGAL_EMAIL: 'privacy@example.com' }), 'privacy@example.com');
  assert.equal(contactEmail({}), undefined);
});

function texts(blocks: Block[]): string[] {
  return blocks.flatMap((b) => ('p' in b ? [b.p] : 'ul' in b ? b.ul : [...b.table.head, ...b.table.rows.flat()]));
}

test('every legal text has sections, names the provider where it must, and has no em dash', () => {
  const p = provider({ ...COMPANY, LEGAL_FINAL: 'true' });
  for (const slug of LEGAL_SLUGS) {
    const doc = legalDocument(slug, p);
    assert.equal(doc.slug, slug);
    assert.ok(doc.sections.length >= 2, `${slug} has sections`);
    const all = [doc.title, doc.summary, ...doc.sections.flatMap((s) => [s.heading, ...texts(s.blocks)])];
    for (const t of all) assert.ok(!t.includes('\u2014'), `${slug}: no em dash in "${t.slice(0, 60)}"`);
    for (const t of all) assert.ok(!/\[(company name|registered address)\]/.test(t), `${slug}: placeholders filled`);
    if (slug === 'dpa' || slug === 'privacy' || slug === 'terms') assert.ok(all.some((t) => t.includes('Skynappse Sp. z o.o.')), `${slug} names the provider`);
  }
  const dpa = legalDocument('dpa', p);
  assert.equal(dpa.version, DPA_VERSION);
  const annex3 = dpa.sections.find((s) => s.heading.startsWith('Annex 3'))!;
  assert.deepEqual(texts(annex3.blocks).filter((t) => SUBPROCESSORS.some((s) => s.name === t)), SUBPROCESSORS.map((s) => s.name), 'the DPA lists the same sub-processors as the page');
  const retention = legalDocument('retention', p);
  const table = retention.sections.flatMap((s) => s.blocks).find((b) => 'table' in b) as Extract<Block, { table: unknown }>;
  assert.equal(table.table.rows.length, RETENTION_ROWS.length);
});

test('old DPA versions stay printable; unknown versions are not invented', () => {
  const p = provider({});
  assert.equal(dpaDocument(DPA_VERSION, p)?.version, DPA_VERSION);
  assert.equal(dpaDocument('2020-01-01', p), undefined);
});

test('deleting an account: sole-member organizations go, shared ones need another owner, billed ones a cancellation', () => {
  const me = 'u-me';
  const members = [
    { organization_id: 'solo', user_id: me, role: 'owner' },
    { organization_id: 'solo-billed', user_id: me, role: 'owner' },
    { organization_id: 'solo-cancelling', user_id: me, role: 'owner' },
    { organization_id: 'shared', user_id: me, role: 'owner' },
    { organization_id: 'shared', user_id: 'u-2', role: 'member' },
    { organization_id: 'co-owned', user_id: me, role: 'owner' },
    { organization_id: 'co-owned', user_id: 'u-3', role: 'owner' },
    { organization_id: 'guest', user_id: me, role: 'member' },
    { organization_id: 'guest', user_id: 'u-4', role: 'owner' },
  ];
  const orgs = [
    { id: 'solo-billed', name: 'Billed' },
    { id: 'shared', name: 'Shared' },
  ];
  const billing = [
    { organization_id: 'solo-billed', status: 'active', cancel_at_period_end: false, cancel_at: null },
    { organization_id: 'solo-cancelling', status: 'active', cancel_at_period_end: true, cancel_at: null },
    { organization_id: 'solo', status: 'canceled', cancel_at_period_end: false, cancel_at: null },
  ];
  const plan = accountDeletionPlan(me, members, orgs, billing);
  assert.deepEqual(plan.deleteOrganizations, ['solo', 'solo-cancelling']);
  assert.deepEqual(plan.blocked, ['Cancel the subscription of Billed on its Billing page first.', 'Make another member of Shared an owner first, or delete that organization.']);
  assert.deepEqual(accountDeletionPlan('nobody', members, orgs, billing), { deleteOrganizations: [], blocked: [] });
});

test('export lines and file names', () => {
  assert.equal(exportLine({ type: 'run', data: { id: 1 } }), '{"type":"run","data":{"id":1}}\n');
  const at = new Date('2026-09-25T12:00:00Z');
  assert.equal(exportFileName('Łódzka Agencja Żółw', at), 'flowretest-lodzka-agencja-zolw-2026-09-25.jsonl');
  assert.equal(exportFileName('???', at), 'flowretest-organization-2026-09-25.jsonl');
});

test('the DPA copy renders with Polish names and the whole agreement', async () => {
  const p = provider({ ...COMPANY, LEGAL_FINAL: 'true' });
  const pdf = await renderDpaRecord({
    doc: dpaDocument(DPA_VERSION, p)!,
    provider: p,
    acceptance: {
      id: '00000000-0000-0000-0000-000000000001',
      organizationName: 'Agencja Żółw',
      companyName: 'Żółw Automatyzacje Sp. z o.o.',
      companyAddress: 'ul. Świętokrzyska 1, 00-001 Warszawa',
      companyId: 'PL1234567890',
      signerName: 'Łucja Żółkiewska',
      signerRole: 'Prezes zarządu',
      signerEmail: 'lucja@zolw.example',
      acceptedAt: '2026-09-25 12:00 UTC',
    },
    printedAt: '2026-09-25 12:05 UTC',
  });
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
  assert.ok(pages >= 3, `${pages} pages`);
  if (process.env.DPA_RECORD_OUT) writeFileSync(process.env.DPA_RECORD_OUT, pdf);
});
