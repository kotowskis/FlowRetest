/** What deleting one person's account does to their organizations: the rules are pure, so they have unit tests. */
import type { createAdminClient } from './supabase/admin.ts';
import { updateCustomerEmail, type StripeConfig } from './stripe.ts';

export interface MemberRow {
  organization_id: string;
  user_id: string;
  role: string;
}

export interface BillingRow {
  organization_id: string;
  status: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
}

export interface AccountDeletionPlan {
  /** Organizations where the person is the only member; they are deleted before the account. */
  deleteOrganizations: string[];
  /** Sentences for the person: why the account cannot be deleted yet. */
  blocked: string[];
}

/** The statuses prevent_billed_org_delete refuses (migration 20261229000000_audit_p1.sql). */
const CHARGING = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

export function accountDeletionPlan(userId: string, members: MemberRow[], orgs: Array<{ id: string; name: string }>, billing: BillingRow[]): AccountDeletionPlan {
  const nameOf = new Map(orgs.map((o) => [o.id, o.name]));
  const out: AccountDeletionPlan = { deleteOrganizations: [], blocked: [] };
  const mine = members.filter((m) => m.user_id === userId);
  for (const m of mine) {
    const others = members.filter((o) => o.organization_id === m.organization_id && o.user_id !== userId);
    const name = nameOf.get(m.organization_id) ?? m.organization_id;
    if (others.length === 0) {
      const b = billing.find((x) => x.organization_id === m.organization_id);
      if (b && b.status && CHARGING.has(b.status) && !b.cancel_at_period_end && !b.cancel_at) {
        out.blocked.push(`Cancel the subscription of ${name} on its Billing page first.`);
      } else {
        out.deleteOrganizations.push(m.organization_id);
      }
    } else if (m.role === 'owner' && !others.some((o) => o.role === 'owner')) {
      out.blocked.push(`Make another member of ${name} an owner first, or delete that organization.`);
    }
  }
  return out;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Deletes a person's account with the organizations only they belong to, after checking accountDeletionPlan. Runs
 * with the service role, so every rule is checked here before anything is deleted and a refusal changes nothing.
 * Organizations that carry on under other owners get the next owner's address on their Stripe customer, so invoices
 * stop going to the deleted person (audit of week 14, item 27). Returns the sentences to show on a refusal.
 */
export async function deleteAccountData(admin: Admin, config: StripeConfig | undefined, userId: string): Promise<{ error?: string }> {
  const { data: mine, error: mineError } = await admin.from('members').select('organization_id, role').eq('user_id', userId);
  if (mineError) return { error: 'Could not read your organizations.' };
  const orgIds = (mine ?? []).map((m) => m.organization_id);
  const [{ data: everyone, error: membersError }, { data: orgs }, { data: billing }] = await Promise.all([
    admin.from('members').select('organization_id, user_id, role, email').in('organization_id', orgIds),
    admin.from('organizations').select('id, name').in('id', orgIds),
    admin.from('billing_accounts').select('organization_id, status, cancel_at_period_end, cancel_at, stripe_customer_id').in('organization_id', orgIds),
  ]);
  if (membersError) return { error: 'Could not read your organizations.' };
  const plan = accountDeletionPlan(userId, everyone ?? [], orgs ?? [], billing ?? []);
  if (plan.blocked.length > 0) return { error: plan.blocked.join(' ') };

  for (const orgId of plan.deleteOrganizations) {
    const { error } = await admin.from('organizations').delete().eq('id', orgId);
    if (error) return { error: 'Could not delete one of your organizations; nothing else was deleted after it. Try again.' };
  }
  if (config) {
    for (const b of billing ?? []) {
      if (plan.deleteOrganizations.includes(b.organization_id)) continue;
      const next = (everyone ?? []).find((m) => m.organization_id === b.organization_id && m.user_id !== userId && m.role === 'owner' && m.email);
      // A failed update leaves the old address in Stripe; the account is deleted anyway and the log says so.
      if (next) await updateCustomerEmail(config, b.stripe_customer_id, next.email).catch((e) => console.error(`[account] Stripe customer ${b.stripe_customer_id} keeps the old email: ${e instanceof Error ? e.message : e}`));
    }
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: 'Could not delete the account. Try again or write to us.' };
  return {};
}
