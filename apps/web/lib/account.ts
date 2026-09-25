/** What deleting one person's account does to their organizations; pure, so the rules have unit tests. */

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
