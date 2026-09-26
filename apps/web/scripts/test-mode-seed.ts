/**
 * Test data of test mode (ADR 0019), written the way people and the runner would: accounts signed in through a link,
 * organizations and workspaces through the RLS client, the Agency plan through the fake Stripe's Checkout and its
 * webhooks, runs through POST /api/runs with a workspace token (so emails, Slack messages and GitHub checks go out to
 * Mailpit and the fakes). Writes that people cannot make themselves (the DPA acceptance, the GitHub link, the Slack
 * webhook, backdated runs) use the service role, as the app does after its own checks.
 *
 * scripts/test-mode.ts calls it once the app answers; the accounts are TEST_ACCOUNTS of lib/test-mode.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type CaseDiff, type PlanReport } from '@flowretest/core';
import type { Database } from '../lib/database.types.ts';
import { DPA_VERSION, TERMS_VERSION } from '../lib/legal/documents.ts';
import { provider, providerSnapshot } from '../lib/legal/provider.ts';
import { validateSlackWebhook } from '../lib/slack.ts';
import { createCheckoutSession, createCustomer, priceFor, type StripeConfig } from '../lib/stripe.ts';
import { TEST_ACCOUNTS } from '../lib/test-mode.ts';
import { generateToken } from '../lib/tokens.ts';

type Db = SupabaseClient<Database>;

export interface SeedConfig {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  appUrl: string;
  /** Base URL of scripts/fake-services.mjs, e.g. http://127.0.0.1:55390. */
  fakeBase: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  slackHosts: string;
  /** Where the plaintext workspace tokens are kept for the summary (.test-mode/ in apps/web). */
  stateDir: string;
  log?: (line: string) => void;
}

export interface SeededToken {
  organization: string;
  workspace: string;
  workspaceId: string;
  token: string;
}

export interface SeedResult {
  /** False when the database already had the test data; the tokens then come from the state file. */
  seeded: boolean;
  tokens: SeededToken[];
}

const [OWNER, DEV, NEW_HIRE, SOLO] = TEST_ACCOUNTS.map((a) => a.email) as [string, string, string, string];
const DAY = 86_400_000;
const tokensFile = (dir: string) => join(dir, 'tokens.json');

export async function seedTestData(config: SeedConfig): Promise<SeedResult> {
  const log = config.log ?? (() => {});
  const admin: Db = createClient<Database>(config.supabaseUrl, config.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Solo Studio is written last: with it the data is complete; with only some test accounts an earlier seed stopped.
  const existing = await admin.from('members').select('email').in('email', [OWNER, SOLO]);
  if (existing.error) throw new Error(`members: ${existing.error.message}`);
  if (existing.data.some((m) => m.email === SOLO)) {
    const file = tokensFile(config.stateDir);
    return { seeded: false, tokens: existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SeededToken[]) : [] };
  }
  const users = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (existing.data.length > 0 || users.data?.users.some((u) => u.email !== undefined && TEST_ACCOUNTS.some((a) => a.email === u.email))) {
    throw new Error('the test data is incomplete (an earlier seed stopped half way); start again with --reset');
  }

  const ids = new Map<string, string>();
  for (const { email } of TEST_ACCOUNTS) {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`account ${email}: ${created.error?.message ?? 'not created'}`);
    ids.set(email, created.data.user.id);
  }
  const signIn = async (email: string): Promise<Db> => {
    const db = createClient<Database>(config.supabaseUrl, config.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error) throw new Error(`sign-in link for ${email}: ${link.error.message}`);
    const signed = await db.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'email' });
    if (signed.error) throw new Error(`sign in as ${email}: ${signed.error.message}`);
    return db;
  };
  const must = <R extends { data: unknown; error: { message: string } | null }>(what: string, r: R): NonNullable<R['data']> => {
    if (r.error || r.data === null || r.data === undefined) throw new Error(`${what}: ${r.error?.message ?? 'no data'}`);
    return r.data as NonNullable<R['data']>;
  };
  const stripe: StripeConfig = { secretKey: config.stripeSecretKey, webhookSecret: config.stripeWebhookSecret, apiUrl: `${config.fakeBase}/stripe`, automaticTax: false, taxUndecided: false, trialDays: 0 };

  // Acme Agency: Agency plan paid through the fake Checkout, the DPA accepted, two customer workspaces.
  const owner = await signIn(OWNER);
  const acme = must('Acme Agency', await owner.rpc('create_organization', { p_name: 'Acme Agency', p_terms_version: TERMS_VERSION }));
  const customer = await createCustomer(stripe, { organizationId: acme, name: 'Acme Agency', email: OWNER });
  must('billing account', await admin.from('billing_accounts').insert({ organization_id: acme, stripe_customer_id: customer.id }).select('organization_id').single());
  const billingUrl = `${config.appUrl}/o/${acme}/billing`;
  const checkout = await createCheckoutSession(stripe, { customer: customer.id, price: (await priceFor(stripe, 'agency', 'month')).id, organizationId: acme, successUrl: `${billingUrl}?checkout=done`, cancelUrl: billingUrl });
  if (!checkout.url) throw new Error('the fake Checkout session has no URL');
  // The fake "pays" on this page and delivers the signed webhooks to the app before it redirects.
  const paid = await fetch(checkout.url, { redirect: 'manual' });
  if (paid.status !== 302) throw new Error(`fake Checkout answered ${paid.status}`);
  const plan = must('Acme plan', await admin.from('billing_accounts').select('plan, status').eq('organization_id', acme).single());
  if (plan.plan !== 'agency' || plan.status !== 'active') throw new Error(`Acme Agency is on ${plan.plan ?? 'no plan'} (${plan.status ?? 'no status'}) after Checkout; is the app receiving the fake Stripe webhooks?`);
  log('Acme Agency on the Agency plan through the fake Stripe');

  const who = provider({});
  must('DPA', await admin.rpc('accept_dpa', {
    p_user: ids.get(OWNER) as string,
    p_org: acme,
    p_version: DPA_VERSION,
    p_company_name: 'Acme Agency Sp. z o.o.',
    p_company_address: 'ul. Testowa 1, 00-001 Warszawa',
    p_company_id: 'KRS 0000000000, NIP PL0000000000',
    p_signer_name: 'Anna Owner',
    p_signer_role: 'Managing director',
    p_provider: providerSnapshot(who),
    p_draft: who.draft,
  }));

  for (const email of [DEV, NEW_HIRE]) must(`invitation ${email}`, await owner.from('invitations').insert({ organization_id: acme, email, invited_by: ids.get(OWNER) as string }).select('id').single());
  // The developer has accepted; the new hire's invitation waits for the first sign-in.
  must('claim', await (await signIn(DEV)).rpc('claim_invitations'));

  const workspace = async (db: Db, org: string, name: string, engine: string, host: string) =>
    must(`workspace ${name}`, await db.from('workspaces').insert({ organization_id: org, name, engine_tag: engine, instance_host: host }).select('id').single()).id;
  const northwind = await workspace(owner, acme, 'Northwind CRM', '2.40.5', 'n8n.northwind.test');
  const globex = await workspace(owner, acme, 'Globex Ops', '2.40.5', 'automation.globex.test');

  const tokens: SeededToken[] = [];
  const token = async (db: Db, organization: string, workspaceName: string, workspaceId: string, userId: string) => {
    const t = generateToken();
    must(`token ${workspaceName}`, await db.from('workspace_tokens').insert({ workspace_id: workspaceId, name: 'test mode', token_hash: t.hash, token_prefix: t.prefix, created_by: userId }).select('id').single());
    tokens.push({ organization, workspace: workspaceName, workspaceId, token: t.token });
    return t.token;
  };
  const northwindToken = await token(owner, 'Acme Agency', 'Northwind CRM', northwind, ids.get(OWNER) as string);
  const globexToken = await token(owner, 'Acme Agency', 'Globex Ops', globex, ids.get(OWNER) as string);

  // Integrations of Northwind: the fake GitHub installation 1001 (acme-agency/flows), a Slack webhook on the fake,
  // and email for the owner. Linking goes through GitHub's OAuth in the app; the seed stores its result.
  must('GitHub link', await admin.from('github_installations').insert({ workspace_id: northwind, installation_id: 1001, account_login: 'acme-agency', account_type: 'Organization', repositories: ['acme-agency/flows'], created_by: ids.get(OWNER) as string }).select('workspace_id').single());
  const slack = validateSlackWebhook(`${config.fakeBase}/slack/services/T0TEST/B0TEST/testmodehook`, config.slackHosts);
  if (!slack.ok) throw new Error(`Slack webhook: ${slack.error}`);
  must('Slack webhook', await admin.from('slack_webhooks').insert({ workspace_id: northwind, url: slack.url, url_hint: slack.hint, statuses: ['DIFF', 'ERROR', 'BLOCKED'], created_by: ids.get(OWNER) as string }).select('id').single());
  must('subscription', await owner.from('notification_subscriptions').insert({ workspace_id: northwind, user_id: ids.get(OWNER) as string, statuses: ['DIFF', 'ERROR', 'BLOCKED'] }).select('workspace_id').single());

  // Runs, oldest first so every workflow ends on its latest status.
  const now = Date.now();
  const upload = (tok: string, daysAgo: number, r: UploadSpec) => uploadRun(config.appUrl, admin, tok, new Date(now - daysAgo * DAY), r);
  await upload(northwindToken, 13, { workflowId: 'lead-intake-1', name: 'Lead intake to HubSpot', cases: [leadCase('1', 'PASS'), leadCase('2', 'PASS')], stable: true });
  await upload(northwindToken, 10, { workflowId: 'invoice-sync-2', name: 'Invoice sync to Google Sheets', cases: [invoiceCase('1', false)], stable: true });
  const mql = await upload(northwindToken, 6, { workflowId: 'lead-intake-1', name: 'Lead intake to HubSpot', cases: [leadCase('1', 'MQL'), leadCase('2', 'MQL')], stable: true, versionId: 'b7d1c2e4-mql' });
  must('acceptance', await owner.rpc('accept_run', { p_run_id: mql, p_case_ids: ['1', '2'], p_message: 'New MQL rule agreed with Northwind sales' }));
  await upload(northwindToken, 4, { workflowId: 'lead-intake-1', name: 'Lead intake to HubSpot', cases: [leadUpgrade('1', false)], upgrade: '2.41.0' });
  await upload(northwindToken, 4, { workflowId: 'lead-intake-1', name: 'Lead intake to HubSpot', cases: [leadUpgrade('1', true)], upgrade: 'v3-nightly' });
  await upload(northwindToken, 4, { workflowId: 'invoice-sync-2', name: 'Invoice sync to Google Sheets', cases: [invoiceCase('1', false)], upgrade: '2.41.0' });
  await upload(northwindToken, 4, { workflowId: 'invoice-sync-2', name: 'Invoice sync to Google Sheets', cases: [invoiceCase('1', false)], upgrade: 'v3-nightly' });
  await upload(northwindToken, 3, { workflowId: 'invoice-sync-2', name: 'Invoice sync to Google Sheets', cases: [invoiceCase('1', true)] });
  await upload(northwindToken, 2, { workflowId: 'order-webhook-3', name: 'Order webhook to Postgres', cases: [orderCase('1')], unsupported: ['Save order (Postgres insert)'] });
  await upload(northwindToken, 1, { workflowId: 'lead-intake-1', name: 'Lead intake to HubSpot', cases: [leadCase('1', 'EMPTY_NAME'), leadCase('2', 'MQL')], git: { repository: 'acme-agency/flows', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', pullRequest: 42, ref: 'refs/pull/42/merge' } });

  await upload(globexToken, 8, { workflowId: 'ticket-router-4', name: 'Support ticket router to Zendesk', cases: [ticketCase('1'), ticketCase('2')], stable: true });
  await upload(globexToken, 5, { workflowId: 'ticket-router-4', name: 'Support ticket router to Zendesk', cases: [ticketCase('1')], upgrade: '2.41.0' });
  await upload(globexToken, 5, { workflowId: 'ticket-router-4', name: 'Support ticket router to Zendesk', cases: [ticketCase('1', true)], upgrade: 'v3-nightly' });
  await upload(globexToken, 1, { workflowId: 'daily-digest-5', name: 'Daily digest to Slack', cases: [digestCase('1')] });
  await upload(globexToken, 0.2, { workflowId: 'ticket-router-4', name: 'Support ticket router to Zendesk', cases: [ticketCase('1'), ticketCase('2')], stable: true });
  log('Acme Agency: 2 workspaces, 5 workflows, 15 runs, 1 acceptance');

  // Solo Studio: the Free plan, one workspace, paid features locked.
  const solo = await signIn(SOLO);
  const studio = must('Solo Studio', await solo.rpc('create_organization', { p_name: 'Solo Studio', p_terms_version: TERMS_VERSION }));
  const clientFlows = await workspace(solo, studio, 'Client flows', '2.40.5', 'n8n.solo-studio.test');
  const soloToken = await token(solo, 'Solo Studio', 'Client flows', clientFlows, ids.get(SOLO) as string);
  await upload(soloToken, 5, { workflowId: 'newsletter-1', name: 'Newsletter signup to Mailchimp', cases: [newsletterCase('1', false)] });
  await upload(soloToken, 1, { workflowId: 'newsletter-1', name: 'Newsletter signup to Mailchimp', cases: [newsletterCase('1', true)] });
  log('Solo Studio: Free plan, 1 workspace, 2 runs');

  mkdirSync(config.stateDir, { recursive: true });
  writeFileSync(tokensFile(config.stateDir), `${JSON.stringify(tokens, null, 2)}\n`);
  return { seeded: true, tokens };
}

// ---------------------------------------------------------------------------------------------------------------
// Reports: calls as the proxy would capture them, diffed and redacted by core like `flowretest upload` does.
// ---------------------------------------------------------------------------------------------------------------

interface Call {
  node: string;
  host: string;
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  /** The sandbox proxy closed the connection: a write the runner could not capture. */
  blocked?: boolean;
}

interface CaseSpec {
  id: string;
  old: Call[];
  new: Call[];
  error?: string;
  engineDifferences?: string[];
}

interface UploadSpec {
  workflowId: string;
  name: string;
  cases: CaseSpec[];
  /** Every case proven stable by `run --stabilize`; acceptance needs it. */
  stable?: boolean;
  /** upgrade-check from 2.40.5 to this n8n tag. */
  upgrade?: string;
  unsupported?: string[];
  versionId?: string;
  git?: { repository: string; sha: string; pullRequest?: number; ref?: string };
}

function capture(caseId: string, version: string, c: Call, ts: number): CaptureRecord {
  const body = c.body ?? {};
  return { ts, version, case: caseId, method: c.method ?? 'POST', host: c.host, port: 443, path: c.path, query: {}, headers: {}, bodyJson: body, bodyBytes: JSON.stringify(body).length, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: c.blocked ? 'close' : 200 } };
}

function caseDiff(spec: CaseSpec): CaseDiff {
  const calls = (version: string, list: Call[]) => list.map((c, i) => normalizeCall(capture(spec.id, version, c, 1_000 + i), { node: c.node, runIndex: 0 }));
  const d = diffCase(spec.id, calls('old', spec.old), calls('new', spec.new), { newError: spec.error });
  return spec.engineDifferences ? { ...d, engineDifferences: spec.engineDifferences } : d;
}

async function uploadRun(appUrl: string, admin: Db, token: string, at: Date, spec: UploadSpec): Promise<string> {
  const cases = spec.cases.map(caseDiff);
  const writes = new Set(spec.cases.flatMap((c) => [...c.old, ...c.new].map((call) => call.node)));
  const report: PlanReport = {
    runner: '0.3.0',
    workflowName: spec.name,
    workflowId: spec.workflowId,
    engine: { image: 'n8nio/n8n:2.40.5' },
    oldLabel: spec.upgrade ? 'n8nio/n8n:2.40.5' : 'recorded',
    newLabel: spec.upgrade ? `n8nio/n8n:${spec.upgrade}` : 'draft.json',
    cases,
    coverage: { writeNodesTotal: writes.size + (spec.unsupported?.length ?? 0), writeNodesCaptured: writes.size, replayedNodes: 1, unsupported: spec.unsupported ?? [] },
    sealed: true,
  };
  const body = {
    schemaVersion: 1,
    generatedAt: at.toISOString(),
    redacted: true,
    ...redactPlanReport(report),
    ...(spec.upgrade ? { upgrade: { engineOld: 'n8nio/n8n:2.40.5', engineNew: `n8nio/n8n:${spec.upgrade}` } } : {}),
    ...(spec.stable ? { stability: Object.fromEntries(cases.map((c) => [c.caseId, true])) } : {}),
    ...(spec.versionId ? { workflowVersionId: spec.versionId } : {}),
    ...(spec.git ? { git: spec.git } : {}),
    run: `${at.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${spec.workflowId}`,
  };
  const res = await fetch(`${appUrl}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status !== 201) throw new Error(`upload of ${spec.workflowId}: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  // The run happened `at`, not now: lists, the drift matrix and retention read created_at.
  const moved = await admin.from('runs').update({ created_at: at.toISOString() }).eq('id', id).select('workflow_id').single();
  if (moved.error) throw new Error(`backdating run ${id}: ${moved.error.message}`);
  const latest = await admin.from('runs').select('created_at').eq('workflow_id', moved.data.workflow_id).order('created_at', { ascending: false }).limit(1).single();
  if (latest.data) await admin.from('workflows').update({ last_run_at: latest.data.created_at }).eq('id', moved.data.workflow_id);
  return id;
}

const HUBSPOT = { host: 'api.hubapi.com', path: '/crm/v3/objects/contacts' };
const SLACK = { host: 'slack.com', path: '/api/chat.postMessage' };

function lead(caseId: string, stage: string, extra: Record<string, unknown> = {}, firstname = caseId === '1' ? 'Maria' : 'Tomasz'): Call {
  return { node: 'Create contact', ...HUBSPOT, body: { properties: { email: `lead${caseId}@northwind.test`, firstname, lifecyclestage: stage, ...extra } } };
}

const notifySales = (id: string): Call => ({ node: 'Notify sales', ...SLACK, body: { channel: 'C0SALES', text: `New lead ${id}` } });
const mqlLead = (id: string) => lead(id, 'marketingqualifiedlead', { company: 'Northwind' });

/** PASS: the same calls; MQL: a new lifecycle rule plus the company; EMPTY_NAME: a broken expression drops the name. */
function leadCase(id: string, variant: 'PASS' | 'MQL' | 'EMPTY_NAME'): CaseSpec {
  if (variant === 'PASS') return { id, old: [lead(id, 'lead'), notifySales(id)], new: [lead(id, 'lead'), notifySales(id)] };
  if (variant === 'MQL') return { id, old: [lead(id, 'lead'), notifySales(id)], new: [mqlLead(id), notifySales(id)] };
  return { id, old: [mqlLead(id), notifySales(id)], new: [lead(id, 'marketingqualifiedlead', { company: 'Northwind' }, ''), notifySales(id)] };
}

/** The accepted workflow on a newer engine: the same calls, or (v3) a Split Out that drops the Slack message. */
function leadUpgrade(id: string, drift: boolean): CaseSpec {
  const calls = [mqlLead(id), notifySales(id)];
  if (!drift) return { id, old: calls, new: calls };
  return { id, old: calls, new: [mqlLead(id)], engineDifferences: ['node "Format lead": 2 items -> 1 item (Split Out drops empty arrays on the new engine)', 'node "Notify sales": not executed'] };
}

function invoiceCase(id: string, changed: boolean): CaseSpec {
  const append = (range: string): Call => ({ node: 'Append invoice', host: 'sheets.googleapis.com', path: `/v4/spreadsheets/1SheetTest/values/${range}:append`, body: { values: [['INV-2026-0142', '1250.00', 'EUR', 'paid']] } });
  const mail: Call = { node: 'Email accounting', host: 'gmail.googleapis.com', path: '/gmail/v1/users/me/messages/send', body: { raw: 'invoice INV-2026-0142 paid' } };
  const old = [append('Invoices!A1'), mail];
  return changed ? { id, old, new: [append('Invoices!A1'), append('Archive!A1')] } : { id, old, new: old };
}

function orderCase(id: string): CaseSpec {
  const shop: Call = { node: 'Confirm order', host: 'api.shop.test', path: '/v1/orders/confirm', body: { order: 'ORD-9921', status: 'confirmed' } };
  const db: Call = { node: 'Save order', host: 'db.frt.invalid', path: '/', body: {}, blocked: true };
  return { id, old: [shop], new: [shop, db] };
}

/** drift: the Switch node on the new engine sends an empty priority to the fallback output. */
function ticketCase(id: string, drift = false): CaseSpec {
  const ticket = (priority: string): Call => ({ node: 'Create ticket', host: 'globex.zendesk.test', path: '/api/v2/tickets.json', body: { ticket: { subject: `Printer ${id} offline`, priority, group_id: 42 } } });
  if (!drift) return { id, old: [ticket('high')], new: [ticket('high')] };
  return { id, old: [ticket('high')], new: [ticket('normal')], engineDifferences: ['node "Route by priority": output 0 -> output 3 (fallback)'] };
}

function digestCase(id: string): CaseSpec {
  return { id, old: [{ node: 'Post digest', ...SLACK, body: { channel: 'C0OPS', text: 'Daily digest: 14 tickets, 2 escalations' } }], new: [], error: "Cannot read properties of undefined (reading 'items') [line 4 in node 'Build digest']" };
}

function newsletterCase(id: string, changed: boolean): CaseSpec {
  const member = (tags: string[]): Call => ({ node: 'Add subscriber', host: 'us21.api.mailchimp.com', path: '/3.0/lists/a1b2c3/members', body: { email_address: 'reader@solo-studio.test', status: 'subscribed', tags } });
  return { id, old: [member(['website'])], new: [member(changed ? ['website', 'autumn-promo'] : ['website'])] };
}
