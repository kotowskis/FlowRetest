'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { session } from '@/lib/data.ts';
import { generateToken } from '@/lib/tokens.ts';

export interface FormState {
  error?: string;
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
