'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { session } from '@/lib/data.ts';
import { generateToken } from '@/lib/tokens.ts';
import { validateSlackWebhook } from '@/lib/slack.ts';

export interface FormState {
  error?: string;
  /** A short confirmation shown next to the form. */
  ok?: string;
  /** A new workspace token, shown once. */
  token?: string;
  done?: number;
}

const Id = z.string().uuid();
const Name = z.string().trim().min(1, 'Name is required.').max(100, 'Keep the name under 100 characters.');
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v));

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.';
}

export async function createOrganization(_prev: FormState, form: FormData): Promise<FormState> {
  const name = Name.safeParse(form.get('name'));
  if (!name.success) return { error: firstIssue(name.error) };
  const { db } = await session();
  const { data, error } = await db.rpc('create_organization', { p_name: name.data });
  if (error || !data) return { error: 'Could not create the organization.' };
  redirect(`/o/${data}`);
}

const WorkspaceInput = z.object({
  orgId: Id,
  name: Name,
  instanceHost: optional(255),
  engineTag: optional(64),
});

export async function createWorkspace(_prev: FormState, form: FormData): Promise<FormState> {
  const input = WorkspaceInput.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: firstIssue(input.error) };
  const { db } = await session();
  const { data, error } = await db
    .from('workspaces')
    .insert({ organization_id: input.data.orgId, name: input.data.name, instance_host: input.data.instanceHost, engine_tag: input.data.engineTag })
    .select('id')
    .single();
  if (error?.code === '23505') return { error: 'A workspace with this name already exists.' };
  if (error || !data) return { error: 'Could not create the workspace.' };
  redirect(`/w/${data.id}`);
}

export async function inviteMember(_prev: FormState, form: FormData): Promise<FormState> {
  const input = z.object({ orgId: Id, email: z.string().trim().toLowerCase().email('Enter a valid email address.') }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: firstIssue(input.error) };
  const { db, user } = await session();
  const { error } = await db.from('invitations').insert({ organization_id: input.data.orgId, email: input.data.email, invited_by: user.id });
  if (error?.code === '23505') return { error: 'This address is already invited.' };
  if (error) return { error: 'Only owners can invite people.' };
  revalidatePath(`/o/${input.data.orgId}`);
  return { done: Date.now() };
}

export async function cancelInvitation(form: FormData): Promise<void> {
  const input = z.object({ orgId: Id, invitationId: Id }).parse(Object.fromEntries(form));
  const { db } = await session();
  await db.from('invitations').delete().eq('id', input.invitationId);
  revalidatePath(`/o/${input.orgId}`);
}

export async function removeMember(form: FormData): Promise<void> {
  const input = z.object({ orgId: Id, userId: Id }).parse(Object.fromEntries(form));
  const { db, user } = await session();
  // The owner cannot remove themselves here; an organization without an owner could not be managed.
  if (input.userId === user.id) return;
  await db.from('members').delete().eq('organization_id', input.orgId).eq('user_id', input.userId);
  revalidatePath(`/o/${input.orgId}`);
}

export async function createToken(_prev: FormState, form: FormData): Promise<FormState> {
  const input = z.object({ workspaceId: Id, name: Name }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: firstIssue(input.error) };
  const { db, user } = await session();
  const created = generateToken();
  const { error } = await db.from('workspace_tokens').insert({ workspace_id: input.data.workspaceId, name: input.data.name, token_hash: created.hash, token_prefix: created.prefix, created_by: user.id });
  if (error) return { error: 'Could not create the token.' };
  revalidatePath(`/w/${input.data.workspaceId}`);
  return { token: created.token, done: Date.now() };
}

export async function revokeToken(form: FormData): Promise<void> {
  const input = z.object({ workspaceId: Id, tokenId: Id }).parse(Object.fromEntries(form));
  const { db } = await session();
  await db.from('workspace_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', input.tokenId).is('revoked_at', null);
  revalidatePath(`/w/${input.workspaceId}`);
}

const CaseId = z.string().min(1).max(200);

/** Records an acceptance; the runner that has the accepted run writes the baselines at its next `pull` or `sync`. */
export async function acceptRun(_prev: FormState, form: FormData): Promise<FormState> {
  const input = z
    .object({ runId: Id, cases: z.array(CaseId).min(1, 'Choose at least one case.').max(500), message: z.string().trim().max(2000, 'Keep the message under 2000 characters.') })
    .safeParse({ runId: form.get('runId'), cases: form.getAll('case'), message: form.get('message') ?? '' });
  if (!input.success) return { error: firstIssue(input.error) };
  const { db } = await session();
  const { error } = await db.rpc('accept_run', { p_run_id: input.data.runId, p_case_ids: input.data.cases, p_message: input.data.message });
  // accept_run raises 22023 with a sentence meant for people (unstable case, wrong status).
  if (error) return { error: error.code === '22023' ? `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.` : 'Could not record the acceptance.' };
  revalidatePath(`/runs/${input.data.runId}`);
  return { done: Date.now(), ok: `Accepted ${input.data.cases.length} case${input.data.cases.length === 1 ? '' : 's'}.` };
}

const STATUSES = ['PASS', 'DIFF', 'ERROR', 'BLOCKED'] as const;

/** The signed-in member's email notifications for one workspace; no status ticked means no emails. */
export async function setSubscription(form: FormData): Promise<void> {
  const input = z.object({ workspaceId: Id, statuses: z.array(z.enum(STATUSES)) }).parse({ workspaceId: form.get('workspaceId'), statuses: form.getAll('status') });
  const { db, user } = await session();
  // Delete and insert instead of upsert: members may update only `statuses`, and an upsert writes every column.
  await db.from('notification_subscriptions').delete().eq('workspace_id', input.workspaceId).eq('user_id', user.id);
  if (input.statuses.length > 0) await db.from('notification_subscriptions').insert({ workspace_id: input.workspaceId, user_id: user.id, statuses: input.statuses });
  revalidatePath(`/w/${input.workspaceId}`);
}

export async function unlinkGitHub(form: FormData): Promise<void> {
  const input = z.object({ workspaceId: Id, installationId: z.coerce.number().int().positive() }).parse({ workspaceId: form.get('workspaceId'), installationId: form.get('installationId') });
  const { db } = await session();
  await db.from('github_installations').delete().eq('workspace_id', input.workspaceId).eq('installation_id', input.installationId);
  revalidatePath(`/w/${input.workspaceId}`);
}

export async function addSlackWebhook(_prev: FormState, form: FormData): Promise<FormState> {
  const input = z.object({ workspaceId: Id, url: z.string().min(1, 'Paste the webhook URL.'), statuses: z.array(z.enum(STATUSES)).min(1, 'Choose at least one status.') }).safeParse({ workspaceId: form.get('workspaceId'), url: form.get('url'), statuses: form.getAll('status') });
  if (!input.success) return { error: firstIssue(input.error) };
  const checked = validateSlackWebhook(input.data.url);
  if (!checked.ok) return { error: checked.error };
  const { db, user } = await session();
  const { error } = await db.from('slack_webhooks').insert({ workspace_id: input.data.workspaceId, url: checked.url, url_hint: checked.hint, statuses: input.data.statuses, created_by: user.id });
  if (error) return { error: 'Only owners can add Slack webhooks.' };
  revalidatePath(`/w/${input.data.workspaceId}`);
  return { done: Date.now(), ok: 'Slack webhook added.' };
}

export async function removeSlackWebhook(form: FormData): Promise<void> {
  const input = z.object({ workspaceId: Id, webhookId: Id }).parse({ workspaceId: form.get('workspaceId'), webhookId: form.get('webhookId') });
  const { db } = await session();
  await db.from('slack_webhooks').delete().eq('id', input.webhookId);
  revalidatePath(`/w/${input.workspaceId}`);
}
