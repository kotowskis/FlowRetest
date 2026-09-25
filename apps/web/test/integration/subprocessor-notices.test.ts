/**
 * Sub-processor change notices (ADR 0016, 0018): the 30-day rule in the database and in the sender, who may read what,
 * one email per owner of every organization, repeatable and parallel sending, notices that cannot be changed, and the
 * public pages (announced changes, Polish DPA).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DPA_VERSION } from '../../lib/legal/documents.ts';
import type { MailMessage, MailResult } from '../../lib/mail.ts';
import { announceNotice, earliestEffectiveOn, sendNotice } from '../../lib/subprocessor-notices.ts';
import { admin, anon, appMissing, appUrl, setPlan, supabaseMissing, user, mustRun } from './helpers.ts';

const skipDb = mustRun(await supabaseMissing());
const skipApp = skipDb ?? mustRun(await appMissing());

type U = Awaited<ReturnType<typeof user>>;
let owner: U;
let coOwner: U;
let member: U;
let otherOwner: U;
const notices: string[] = [];
const tag = randomUUID().slice(0, 6);

async function org(u: U, name: string, dpa: boolean): Promise<string> {
  const id = (await u.db.rpc('create_organization', { p_name: `${name} ${tag}` })).data as string;
  if (dpa) assert.ifError((await admin().rpc('accept_dpa', { p_user: u.id, p_org: id, p_version: DPA_VERSION, p_company_name: name, p_company_address: 'Warszawa', p_company_id: '', p_signer_name: 'A', p_signer_role: 'CEO', p_provider: { name: 'P', address: 'A', companyId: 'C', email: 'e@example.com' }, p_draft: true })).error);
  return id;
}

before(async () => {
  if (skipDb) return;
  owner = await user('notice-owner');
  coOwner = await user('notice-coowner');
  member = await user('notice-member');
  otherOwner = await user('notice-nodpa');
  const a = await org(owner, 'Alpha', true);
  // Three people in Alpha: more seats than Free has.
  await setPlan(a, 'agency');
  await org(owner, 'Beta', true);
  // A second owner of Alpha gets their own email; a plain member gets none.
  assert.ifError((await admin().from('members').insert([{ organization_id: a, user_id: coOwner.id, email: coOwner.email, role: 'owner' }, { organization_id: a, user_id: member.id, email: member.email, role: 'member' }])).error);
  await org(otherOwner, 'Gamma', false);
});

after(async () => {
  // A notice with a delivered email is kept as proof; the test removes its log first.
  if (notices.length) {
    await admin().from('subprocessor_notice_deliveries').delete().in('notice_id', notices);
    await admin().from('subprocessor_notices').delete().in('id', notices);
  }
});

const delivered: MailResult = { ok: true, transport: 'mailpit' };

const input = (effectiveOn: string) => ({ effectiveOn, summary: `Email delivery moves to Postmark ${tag}.`, changes: [{ action: 'add' as const, name: `Postmark ${tag}`, purpose: 'Email delivery', data: 'Email addresses', location: 'EU' }] });

test('a change needs 30 days of notice; notices are public, people cannot write them, deliveries stay private', { skip: skipDb }, async () => {
  const thirty = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await assert.rejects(announceNotice(admin(), input(thirty)), /at least 30 days ahead/, '30 dates ahead can be under 30 full days');
  const n = await announceNotice(admin(), input(earliestEffectiveOn(new Date())));
  notices.push(n.id);
  assert.equal((await anon().from('subprocessor_notices').select('id').eq('id', n.id)).data?.length, 1, 'anyone reads notices');
  assert.ok((await owner.db.from('subprocessor_notices').insert({ effective_on: '2030-01-01', summary: 'x', changes: [{ action: 'add', name: 'x' }] })).error, 'people cannot announce');
  assert.ok((await owner.db.rpc('subprocessor_notice_recipients')).error, 'recipients are for the service role');
  assert.equal((await owner.db.from('subprocessor_notice_deliveries').select('email')).data?.length ?? 0, 0);
});

test('one email per owner of every organization; repeatable, failed ones are tried again', { skip: skipDb }, async () => {
  const n = await announceNotice(admin(), input(earliestEffectiveOn(new Date())));
  notices.push(n.id);
  const ours = new Set([owner.email, coOwner.email, member.email, otherOwner.email]);
  const sent: MailMessage[] = [];
  let failFor: string | undefined = coOwner.email;
  const send = async (m: MailMessage): Promise<MailResult> => {
    if (ours.has(m.to)) sent.push(m);
    return m.to === failFor ? { ok: false, transport: 'mailpit', detail: 'mailbox full' } : delivered;
  };

  const first = await sendNotice(admin(), n.id, { send, appUrl: 'https://app.example', contact: 'privacy@example.com' });
  assert.ok(first.failed >= 1);
  assert.deepEqual(sent.map((m) => m.to).sort(), [owner.email, coOwner.email, otherOwner.email].sort(), 'every owner, also of the organization without a DPA acceptance; not the member');
  const mine = sent.find((m) => m.to === owner.email)!;
  assert.match(mine.text, new RegExp(`owner of "Alpha ${tag}", "Beta ${tag}"`), 'one email naming both organizations');
  assert.match(mine.text, new RegExp(`New: Postmark ${tag}`));
  const failed = (await admin().from('subprocessor_notice_deliveries').select('ok, detail').eq('notice_id', n.id).eq('email', coOwner.email).single()).data!;
  assert.deepEqual([failed.ok, failed.detail], [false, 'mailpit: mailbox full']);

  sent.length = 0;
  failFor = undefined;
  const second = await sendNotice(admin(), n.id, { send, appUrl: 'https://app.example' });
  assert.deepEqual(sent.map((m) => m.to), [coOwner.email], 'only the failed address again');
  assert.equal(second.failed, 0);
  sent.length = 0;
  const third = await sendNotice(admin(), n.id, { send, appUrl: 'https://app.example' });
  assert.equal(sent.length, 0);
  assert.equal(third.sent, 0);
  assert.equal(third.skipped, third.recipients);

  const dry = await sendNotice(admin(), n.id, { send, appUrl: 'https://app.example', dryRun: true });
  assert.equal(dry.sent, 0);
});

test('a logged email is not a delivery, two runs at once send each email once, fewer than 30 days left refuse', { skip: skipDb }, async () => {
  const n = await announceNotice(admin(), input(earliestEffectiveOn(new Date())));
  notices.push(n.id);
  const ours = new Set([owner.email, coOwner.email, otherOwner.email]);
  const logged = await sendNotice(admin(), n.id, { send: async () => ({ ok: true, transport: 'log', detail: 'no transport configured' }), appUrl: 'https://app.example' });
  assert.equal(logged.sent, 0, 'without a transport nothing counts as sent');
  assert.ok(logged.failed >= 3);

  const sent: string[] = [];
  const slow = async (m: MailMessage): Promise<MailResult> => {
    if (ours.has(m.to)) sent.push(m.to);
    await new Promise((r) => setTimeout(r, 5));
    return delivered;
  };
  await Promise.all([sendNotice(admin(), n.id, { send: slow, appUrl: 'https://app.example' }), sendNotice(admin(), n.id, { send: slow, appUrl: 'https://app.example' })]);
  assert.deepEqual(sent.sort(), [...ours].sort(), 'each of our owners once');

  // Twenty days later the change is 11 days away: the email would not give the 30 days the DPA promises.
  const later = new Date(Date.now() + 20 * 86_400_000);
  await assert.rejects(sendNotice(admin(), n.id, { send: slow, appUrl: 'https://app.example', now: later }), /only 1[01] days are left/);
});

test('an announced notice cannot be changed, nor deleted once owners were emailed', { skip: skipDb }, async () => {
  const n = await announceNotice(admin(), input(earliestEffectiveOn(new Date())));
  notices.push(n.id);
  const back = await admin().from('subprocessor_notices').insert({ announced_at: '2020-01-01T00:00:00Z', effective_on: '2020-03-01', summary: 'backdated', changes: [{ action: 'add', name: 'x' }] });
  assert.equal(back.error?.code, '23514', 'the announcement time is the database clock');
  assert.ok((await admin().from('subprocessor_notices').update({ summary: 'changed' }).eq('id', n.id)).error, 'no edits after the announcement');
  assert.ok((await admin().from('subprocessor_notices').insert({ effective_on: '2030-01-01', summary: 'x', changes: [1, 'x'] })).error, 'changes are checked');
  assert.ifError((await admin().from('subprocessor_notice_deliveries').insert({ notice_id: n.id, email: `proof-${tag}@example.com`, organization_ids: [], ok: true })).error);
  assert.ok((await admin().from('subprocessor_notices').delete().eq('id', n.id)).error, 'the notice stays while its delivery log exists');
});

test('pages: announced changes on /legal/subprocessors, the DPA in Polish, the Polish PDF copy', { skip: skipApp }, async () => {
  if (notices.length === 0) notices.push((await announceNotice(admin(), input(earliestEffectiveOn(new Date())))).id);
  // React separates text nodes with <!-- --> in the HTML.
  const page = (await (await fetch(`${appUrl}/legal/subprocessors`)).text()).replace(/<!-- -->/g, '');
  assert.match(page, new RegExp(`Email delivery moves to Postmark ${tag}`));
  assert.match(page, /Takes effect on \d{4}-\d{2}-\d{2}/);

  const pl = await fetch(`${appUrl}/legal/dpa?lang=pl`);
  assert.equal(pl.status, 200);
  const html = await pl.text();
  assert.match(html, /Umowa powierzenia przetwarzania danych osobowych/);
  assert.match(html, /<main lang="pl"/);
  assert.match(await (await fetch(`${appUrl}/legal/dpa?lang=de`)).text(), /Data Processing Agreement/, 'unknown languages fall back to English');

  const orgId = (await owner.db.from('organizations').select('id').eq('name', `Alpha ${tag}`).single()).data!.id;
  const acceptance = (await owner.db.from('dpa_acceptances').select('id').eq('organization_id', orgId).limit(1).single()).data!.id;
  const pdf = await fetch(`${appUrl}/o/${orgId}/dpa/${acceptance}/pdf?lang=pl`, { headers: { cookie: owner.cookie } });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-disposition') ?? '', /-pl\.pdf"$/);
  assert.equal((await fetch(`${appUrl}/o/${orgId}/dpa/${acceptance}/pdf?lang=de`, { headers: { cookie: owner.cookie } })).status, 400);
  const data = await (await fetch(`${appUrl}/o/${orgId}/data`, { headers: { cookie: owner.cookie } })).text();
  assert.match(data, /Announced sub-processor changes/);
  assert.match(data, /PDF \(PL\)/);
});
