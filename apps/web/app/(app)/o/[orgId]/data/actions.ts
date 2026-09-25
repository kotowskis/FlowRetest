'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { session } from '@/lib/data.ts';
import { DPA_VERSION, dpaAcceptanceOpen } from '@/lib/legal/documents.ts';
import { provider, providerSnapshot } from '@/lib/legal/provider.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import type { FormState } from '../../../actions.ts';

const Id = z.string().uuid();

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.';
}

/** A shorter run history than the plan's, or the plan's again when the field is empty. */
export async function setRetention(_prev: FormState, form: FormData): Promise<FormState> {
  const input = z
    .object({
      orgId: Id,
      days: z
        .string()
        .trim()
        .transform((v) => (v === '' ? null : Number(v)))
        .pipe(z.number().int('Enter whole days.').min(1, 'Keep runs for at least 1 day.').max(3650, 'At most 3650 days.').nullable()),
    })
    .safeParse({ orgId: form.get('orgId'), days: form.get('days') ?? '' });
  if (!input.success) return { error: firstIssue(input.error) };
  const { db } = await session();
  const { data, error } = await db.from('organizations').update({ retention_days: input.data.days }).eq('id', input.data.orgId).select('id');
  if (error || !data?.length) return { error: 'Only owners can change the run history.' };
  revalidatePath(`/o/${input.data.orgId}/data`);
  if (input.data.days === null) return { done: Date.now(), ok: 'Run history follows the plan.' };
  // The nightly purge takes the shorter period, so a longer one than the plan's changes nothing.
  const { data: limits } = await db.rpc('org_plan', { org: input.data.orgId });
  const planDays = limits?.[0]?.retention_days;
  if (planDays !== undefined && input.data.days >= planDays) return { done: Date.now(), ok: `Saved. The plan keeps runs ${planDays} days, which is shorter, so that period applies.` };
  return { done: Date.now(), ok: `Runs older than ${input.data.days} days are deleted tonight.` };
}

/**
 * Characters the PDF font (Inter) can print: Latin, Greek and Cyrillic letters with digits, punctuation and common
 * signs. A company name with emoji or CJK would come out as garbage on the signed copy (audit of week 14, item 24).
 */
const PRINTABLE = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{M}\p{N}\p{P}\p{Zs}\p{Sc}\p{Sm}\p{Sk}°§©®™№]*$/u;
const unprintable = (what: string) => `${what} can use Latin, Greek or Cyrillic letters, digits and punctuation only; the PDF copy cannot print other characters.`;

const Text = (max: number, what: string) =>
  z
    .string()
    .trim()
    .min(1, `${what} is required.`)
    .max(max, `Keep ${what.toLowerCase()} under ${max} characters.`)
    .regex(PRINTABLE, unprintable(what));

/** Records that an owner accepted the current DPA for the organization, with the company and the signer. */
export async function acceptDpa(_prev: FormState, form: FormData): Promise<FormState> {
  const input = z
    .object({
      orgId: Id,
      version: z.literal(DPA_VERSION, 'The agreement changed while the page was open; reload it and read the new version.'),
      companyName: Text(200, 'Company name'),
      companyAddress: Text(500, 'Address'),
      companyId: z.string().trim().max(100, 'Keep the registration number under 100 characters.').regex(PRINTABLE, unprintable('The registration number')),
      signerName: Text(200, 'Your name'),
      signerRole: Text(200, 'Your role'),
      authority: z.literal('on', 'Confirm that you may accept agreements for the company.'),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { error: firstIssue(input.error) };
  const who = provider();
  if (!dpaAcceptanceOpen(who)) return { error: 'The DPA is still a draft and cannot be accepted yet. Write to us if you need it signed now.' };
  const { user } = await session();
  // Only the server may call accept_dpa (audit of week 14, item 2): the draft and version checks above cannot be
  // skipped, and the row keeps the provider's details and the draft flag the owner saw. The function checks that the
  // signed-in user owns the organization.
  const { error } = await createAdminClient().rpc('accept_dpa', {
    p_user: user.id,
    p_org: input.data.orgId,
    p_version: input.data.version,
    p_company_name: input.data.companyName,
    p_company_address: input.data.companyAddress,
    p_company_id: input.data.companyId,
    p_signer_name: input.data.signerName,
    p_signer_role: input.data.signerRole,
    p_provider: providerSnapshot(who),
    p_draft: who.draft,
  });
  if (error) return { error: error.code === '42501' ? 'Only owners can accept the DPA.' : 'Could not record the acceptance.' };
  revalidatePath(`/o/${input.data.orgId}/data`);
  return { done: Date.now(), ok: 'Accepted. The PDF copy is in the list below.' };
}

/** Deletes the organization with every workspace, run and acceptance; refused while a subscription still charges. */
export async function deleteOrganization(_prev: FormState, form: FormData): Promise<FormState> {
  const input = z.object({ orgId: Id, confirm: z.string() }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: firstIssue(input.error) };
  const { db } = await session();
  const { data: org } = await db.from('organizations').select('name').eq('id', input.data.orgId).maybeSingle();
  if (!org) return { error: 'Organization not found.' };
  if (input.data.confirm.trim() !== org.name) return { error: 'Type the name of the organization exactly as shown.' };
  const { data, error } = await db.from('organizations').delete().eq('id', input.data.orgId).select('id');
  if (error?.hint === 'subscription') return { error: 'Cancel the subscription on the Billing page first. The organization can be deleted once the cancellation is scheduled.' };
  if (error || !data?.length) return { error: 'Only owners can delete the organization.' };
  revalidatePath('/orgs');
  redirect('/orgs?deleted=organization');
}
