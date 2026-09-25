import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient, type Db } from './supabase/server.ts';
import type { Tables } from './database.types.ts';
import type { Notice } from './subprocessor-notices.ts';
import { INVITATION_DAYS } from './legal/documents.ts';

export type Organization = Tables<'organizations'>;
export type Workspace = Tables<'workspaces'>;
export type Workflow = Tables<'workflows'>;
export type Run = Tables<'runs'>;
export type Acceptance = Tables<'acceptances'>;
export type TokenRow = Pick<Tables<'workspace_tokens'>, 'id' | 'name' | 'token_prefix' | 'created_at' | 'last_used_at' | 'revoked_at'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are user input; anything that is not a UUID is a 404 before it reaches PostgREST. */
export function assertId(id: string): string {
  if (!UUID.test(id)) notFound();
  return id;
}

/** The signed-in user and an RLS client, once per request. proxy.ts already redirects anonymous visitors. */
export const session = cache(async (): Promise<{ db: Db; user: User }> => {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect('/login');
  return { db, user: data.user };
});

/** Data of a PostgREST response; a query error throws, a missing row (RLS hides it or it does not exist) is a 404. */
function orFail<R extends { data: unknown; error: { message: string } | null }>(result: R, what: string): NonNullable<R['data']> {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) notFound();
  return result.data as NonNullable<R['data']>;
}

export async function listOrganizations(): Promise<Array<Organization & { role: string }>> {
  const { db, user } = await session();
  const orgs = orFail(await db.from('organizations').select('*').order('created_at'), 'organizations');
  const roles = orFail(await db.from('members').select('organization_id, role').eq('user_id', user.id), 'members');
  const roleOf = new Map(roles.map((r) => [r.organization_id, r.role]));
  return orgs.map((o) => ({ ...o, role: roleOf.get(o.id) ?? 'member' }));
}

/** The organization's plan with its limits and what it uses now (org_plan); `workspaces` null means no limit. */
export interface PlanLimits {
  plan: string;
  workspaces: number | null;
  seats: number;
  retention_days: number;
  uploads_per_day: number;
  integrations: boolean;
  workspaces_used: number;
  seats_used: number;
  uploads_last_day: number;
  pdf_export: boolean;
  drift_matrix: boolean;
}

export type BillingAccount = Pick<Tables<'billing_accounts'>, 'plan' | 'status' | 'billing_interval' | 'current_period_end' | 'cancel_at_period_end' | 'cancel_at' | 'ended_at' | 'trial_end' | 'first_subscription_at'>;

async function planLimits(db: Db, orgId: string): Promise<PlanLimits> {
  const { data, error } = await db.rpc('org_plan', { org: orgId });
  if (error) throw new Error(`org_plan: ${error.message}`);
  const row = data?.[0];
  if (!row) notFound();
  return row as PlanLimits;
}

export async function getOrganization(orgId: string) {
  const { db, user } = await session();
  assertId(orgId);
  const org = orFail(await db.from('organizations').select('*').eq('id', orgId).maybeSingle(), 'organization');
  const [workspaces, members, invitations, limits] = await Promise.all([
    db.from('workspaces').select('*').eq('organization_id', orgId).order('created_at'),
    db.from('members').select('*').eq('organization_id', orgId).order('created_at'),
    // Invitations older than 30 days no longer work (claim_invitations skips them) and wait for the nightly purge.
    db.from('invitations').select('*').eq('organization_id', orgId).gt('created_at', new Date(Date.now() - INVITATION_DAYS * 86_400_000).toISOString()).order('created_at'),
    planLimits(db, orgId),
  ]);
  const memberRows = orFail(members, 'members');
  return {
    org,
    workspaces: orFail(workspaces, 'workspaces'),
    members: memberRows,
    invitations: orFail(invitations, 'invitations'),
    limits,
    isOwner: memberRows.some((m) => m.user_id === user.id && m.role === 'owner'),
    userId: user.id,
  };
}

export async function getBilling(orgId: string) {
  const { db } = await session();
  assertId(orgId);
  const org = orFail(await db.from('organizations').select('*').eq('id', orgId).maybeSingle(), 'organization');
  const [plans, account, invoices, owner, limits] = await Promise.all([
    db.from('plans').select('*').order('sort'),
    db.from('billing_accounts').select('plan, status, billing_interval, current_period_end, cancel_at_period_end, cancel_at, ended_at, trial_end, first_subscription_at').eq('organization_id', orgId).maybeSingle(),
    // RLS gives invoices to owners only; members get an empty list.
    db.from('invoices').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(50),
    db.rpc('is_owner', { org: orgId }),
    planLimits(db, orgId),
  ]);
  if (account.error) throw new Error(`billing account: ${account.error.message}`);
  return {
    org,
    plans: orFail(plans, 'plans'),
    account: (account.data ?? undefined) as BillingAccount | undefined,
    invoices: orFail(invoices, 'invoices'),
    isOwner: owner.data === true,
    limits,
  };
}

export async function getWorkspace(workspaceId: string) {
  const { db, user } = await session();
  assertId(workspaceId);
  const workspace = orFail(await db.from('workspaces').select('*').eq('id', workspaceId).maybeSingle(), 'workspace');
  const [org, tokens, workflows] = await Promise.all([
    db.from('organizations').select('*').eq('id', workspace.organization_id).single(),
    db.from('workspace_tokens').select('id, name, token_prefix, created_at, last_used_at, revoked_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    db.from('workflows').select('*').eq('workspace_id', workspaceId).order('last_run_at', { ascending: false, nullsFirst: false }),
  ]);
  const [subscription, installations, slack, owner, overLimit, limits] = await Promise.all([
    db.from('notification_subscriptions').select('statuses').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle(),
    db.from('github_installations').select('installation_id, account_login, account_type, repositories, suspended_at, created_at').eq('workspace_id', workspaceId).order('created_at'),
    db.from('slack_webhooks').select('id, url_hint, statuses, created_at').eq('workspace_id', workspaceId).order('created_at'),
    db.rpc('is_owner', { org: workspace.organization_id }),
    db.rpc('workspace_over_limit', { ws: workspaceId }),
    planLimits(db, workspace.organization_id),
  ]);
  if (subscription.error) throw new Error(`subscription: ${subscription.error.message}`);
  return {
    workspace,
    org: orFail(org, 'organization'),
    tokens: orFail(tokens, 'tokens') as TokenRow[],
    workflows: orFail(workflows, 'workflows'),
    statuses: subscription.data?.statuses ?? [],
    installations: orFail(installations, 'installations'),
    slackHooks: orFail(slack, 'slack webhooks'),
    isOwner: owner.data === true,
    overLimit: overLimit.data === true,
    limits,
  };
}

/** Run list columns: everything but the report itself, which can be megabytes. */
const RUN_COLUMNS = 'id, workspace_id, workflow_id, status, mode, runner, engine_image, old_label, new_label, sealed, local_run, summary, report_bytes, generated_at, created_at, workflow_version_id';
export type RunListItem = Omit<Run, 'report' | 'token_id'>;

/**
 * Two runs of one workflow for the comparison page, with their reports; either id missing, of another workflow or
 * hidden by RLS is a 404. `runs` lists the latest runs for the pickers.
 */
export async function getRunPair(workflowId: string, beforeId: string, afterId: string) {
  const { workflow, workspace, org, runs } = await getWorkflow(workflowId);
  assertId(beforeId);
  assertId(afterId);
  const { data, error } = await (await session()).db.from('runs').select(`${RUN_COLUMNS}, report`).eq('workflow_id', workflowId).in('id', [beforeId, afterId]);
  if (error) throw new Error(`runs: ${error.message}`);
  const before = data?.find((r) => r.id === beforeId);
  const after = data?.find((r) => r.id === afterId);
  if (!before || !after) notFound();
  return { workflow, workspace, org, runs, before, after };
}

export async function getWorkflow(workflowId: string, limit = 100) {
  const { db } = await session();
  assertId(workflowId);
  const workflow = orFail(await db.from('workflows').select('*').eq('id', workflowId).maybeSingle(), 'workflow');
  const [workspace, runs, acceptances] = await Promise.all([
    db.from('workspaces').select('*').eq('id', workflow.workspace_id).single(),
    db.from('runs').select(RUN_COLUMNS).eq('workflow_id', workflowId).order('created_at', { ascending: false }).limit(limit),
    db.from('acceptances').select('*').eq('workflow_id', workflowId).order('created_at', { ascending: false }).limit(limit),
  ]);
  const ws = orFail(workspace, 'workspace');
  const org = orFail(await db.from('organizations').select('*').eq('id', ws.organization_id).single(), 'organization');
  return { workflow, workspace: ws, org, runs: orFail(runs, 'runs') as RunListItem[], acceptances: orFail(acceptances, 'acceptances') };
}

export async function getRun(runId: string) {
  const { db } = await session();
  assertId(runId);
  const run = orFail(await db.from('runs').select('*').eq('id', runId).maybeSingle(), 'run');
  const [workflow, workspace, neighbours, acceptances] = await Promise.all([
    db.from('workflows').select('*').eq('id', run.workflow_id).single(),
    db.from('workspaces').select('*').eq('id', run.workspace_id).single(),
    // The run before this one, for the "previous run" link in the header.
    db.from('runs').select('id, status, created_at').eq('workflow_id', run.workflow_id).lt('created_at', run.created_at).order('created_at', { ascending: false }).limit(1),
    db.from('acceptances').select('*').eq('run_id', run.id).order('created_at', { ascending: false }),
  ]);
  const checks = await db.from('github_checks').select('ok, html_url, conclusion, detail, created_at').eq('run_id', run.id).order('created_at', { ascending: false }).limit(1);
  const ws = orFail(workspace, 'workspace');
  const [orgRow, limits, owner] = await Promise.all([db.from('organizations').select('*').eq('id', ws.organization_id).single(), planLimits(db, ws.organization_id), db.rpc('is_owner', { org: ws.organization_id })]);
  const org = orFail(orgRow, 'organization');
  return { run, workflow: orFail(workflow, 'workflow'), workspace: ws, org, previous: orFail(neighbours, 'runs')[0], acceptances: orFail(acceptances, 'acceptances'), check: checks.data?.[0], pdfExport: limits.pdf_export, plan: limits.plan, isOwner: owner.data === true };
}

export type DriftCell = Tables<'latest_upgrade_runs'>;

/**
 * Every cell of the drift view for these workspaces. PostgREST returns at most max_rows (1000) rows per request and
 * says nothing when it cuts, so the rows are read in pages.
 */
async function driftCells(db: Db, workspaceIds: string[]): Promise<DriftCell[]> {
  const out: DriftCell[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db.from('latest_upgrade_runs').select('*').in('workspace_id', workspaceIds).order('id').range(from, from + page - 1);
    if (error) throw new Error(`drift: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < page) return out;
  }
}

/** Drift matrix of one workspace: the latest upgrade-check of each workflow against each target engine. */
export async function getWorkspaceDrift(workspaceId: string) {
  const { db } = await session();
  assertId(workspaceId);
  const workspace = orFail(await db.from('workspaces').select('*').eq('id', workspaceId).maybeSingle(), 'workspace');
  const [org, cells, workflows, limits] = await Promise.all([
    db.from('organizations').select('*').eq('id', workspace.organization_id).single(),
    driftCells(db, [workspaceId]),
    db.from('workflows').select('id, name, n8n_workflow_id').eq('workspace_id', workspaceId),
    planLimits(db, workspace.organization_id),
  ]);
  return { workspace, org: orFail(org, 'organization'), cells, workflows: orFail(workflows, 'workflows'), limits };
}

/** Drift matrix of an organization: the same cells for every workspace, summed per workspace and target engine. */
export async function getOrganizationDrift(orgId: string) {
  const { db } = await session();
  assertId(orgId);
  const org = orFail(await db.from('organizations').select('*').eq('id', orgId).maybeSingle(), 'organization');
  const [workspaces, limits] = await Promise.all([db.from('workspaces').select('id, name, engine_tag').eq('organization_id', orgId).order('name'), planLimits(db, orgId)]);
  const wsRows = orFail(workspaces, 'workspaces');
  const cells = wsRows.length ? await driftCells(db, wsRows.map((w) => w.id)) : [];
  return { org, workspaces: wsRows, cells, limits };
}

export type DpaAcceptance = Tables<'dpa_acceptances'>;

/** The organization's Data page: history setting, DPA acceptances, what an export would hold. */
export async function getOrganizationData(orgId: string) {
  const { db, user } = await session();
  assertId(orgId);
  const org = orFail(await db.from('organizations').select('*').eq('id', orgId).maybeSingle(), 'organization');
  const [owner, limits, dpa, workspaces, notices] = await Promise.all([
    db.rpc('is_owner', { org: orgId }),
    planLimits(db, orgId),
    db.from('dpa_acceptances').select('*').eq('organization_id', orgId).order('accepted_at', { ascending: false }),
    db.from('workspaces').select('id, name').eq('organization_id', orgId).order('created_at'),
    // Sub-processor changes that have not taken effect yet (public rows).
    db.from('subprocessor_notices').select('*').gte('effective_on', new Date().toISOString().slice(0, 10)).order('effective_on'),
  ]);
  const wsRows = orFail(workspaces, 'workspaces');
  const runs = wsRows.length
    ? await db.from('runs').select('id', { count: 'exact', head: true }).in('workspace_id', wsRows.map((w) => w.id))
    : { count: 0, error: null };
  if (runs.error) throw new Error(`runs: ${runs.error.message}`);
  return { org, isOwner: owner.data === true, limits, dpa: orFail(dpa, 'dpa acceptances'), workspaces: wsRows, runCount: runs.count ?? 0, email: user.email ?? '', upcoming: orFail(notices, 'subprocessor notices') as unknown as Notice[] };
}
