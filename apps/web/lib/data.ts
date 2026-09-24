import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient, type Db } from './supabase/server.ts';
import type { Tables } from './database.types.ts';

export type Organization = Tables<'organizations'>;
export type Member = Tables<'members'>;
export type Invitation = Tables<'invitations'>;
export type Workspace = Tables<'workspaces'>;
export type Workflow = Tables<'workflows'>;
export type Run = Tables<'runs'>;
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

export async function getOrganization(orgId: string) {
  const { db, user } = await session();
  assertId(orgId);
  const org = orFail(await db.from('organizations').select('*').eq('id', orgId).maybeSingle(), 'organization');
  const [workspaces, members, invitations] = await Promise.all([
    db.from('workspaces').select('*').eq('organization_id', orgId).order('name'),
    db.from('members').select('*').eq('organization_id', orgId).order('created_at'),
    db.from('invitations').select('*').eq('organization_id', orgId).order('created_at'),
  ]);
  const memberRows = orFail(members, 'members');
  return {
    org,
    workspaces: orFail(workspaces, 'workspaces'),
    members: memberRows,
    invitations: orFail(invitations, 'invitations'),
    isOwner: memberRows.some((m) => m.user_id === user.id && m.role === 'owner'),
    userId: user.id,
  };
}

export async function getWorkspace(workspaceId: string) {
  const { db } = await session();
  assertId(workspaceId);
  const workspace = orFail(await db.from('workspaces').select('*').eq('id', workspaceId).maybeSingle(), 'workspace');
  const [org, tokens, workflows] = await Promise.all([
    db.from('organizations').select('*').eq('id', workspace.organization_id).single(),
    db.from('workspace_tokens').select('id, name, token_prefix, created_at, last_used_at, revoked_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    db.from('workflows').select('*').eq('workspace_id', workspaceId).order('last_run_at', { ascending: false, nullsFirst: false }),
  ]);
  return { workspace, org: orFail(org, 'organization'), tokens: orFail(tokens, 'tokens') as TokenRow[], workflows: orFail(workflows, 'workflows') };
}

/** Run list columns: everything but the report itself, which can be megabytes. */
const RUN_COLUMNS = 'id, workspace_id, workflow_id, status, mode, runner, engine_image, old_label, new_label, sealed, local_run, summary, report_bytes, generated_at, created_at';
export type RunListItem = Omit<Run, 'report' | 'token_id'>;

export async function getWorkflow(workflowId: string, limit = 100) {
  const { db } = await session();
  assertId(workflowId);
  const workflow = orFail(await db.from('workflows').select('*').eq('id', workflowId).maybeSingle(), 'workflow');
  const [workspace, runs] = await Promise.all([
    db.from('workspaces').select('*').eq('id', workflow.workspace_id).single(),
    db.from('runs').select(RUN_COLUMNS).eq('workflow_id', workflowId).order('created_at', { ascending: false }).limit(limit),
  ]);
  const ws = orFail(workspace, 'workspace');
  const org = orFail(await db.from('organizations').select('*').eq('id', ws.organization_id).single(), 'organization');
  return { workflow, workspace: ws, org, runs: orFail(runs, 'runs') as RunListItem[] };
}

export async function getRun(runId: string) {
  const { db } = await session();
  assertId(runId);
  const run = orFail(await db.from('runs').select('*').eq('id', runId).maybeSingle(), 'run');
  const [workflow, workspace, neighbours] = await Promise.all([
    db.from('workflows').select('*').eq('id', run.workflow_id).single(),
    db.from('workspaces').select('*').eq('id', run.workspace_id).single(),
    // The run before this one, for the "previous run" link in the header.
    db.from('runs').select('id, status, created_at').eq('workflow_id', run.workflow_id).lt('created_at', run.created_at).order('created_at', { ascending: false }).limit(1),
  ]);
  const ws = orFail(workspace, 'workspace');
  const org = orFail(await db.from('organizations').select('*').eq('id', ws.organization_id).single(), 'organization');
  return { run, workflow: orFail(workflow, 'workflow'), workspace: ws, org, previous: orFail(neighbours, 'runs')[0] };
}
