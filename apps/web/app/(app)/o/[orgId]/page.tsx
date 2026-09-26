import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrganization } from '@/lib/data.ts';
import { ActionForm, ConfirmButton } from '@/components/forms.tsx';
import { Empty, OrgNav, PageHeader, Section, Time, inputClass, secondaryButtonClass } from '@/components/ui.tsx';
import { TERMS_VERSION } from '@/lib/legal/documents.ts';
import { acceptTerms, cancelInvitation, createWorkspace, inviteMember, makeOwner, removeMember } from '../../actions.ts';

export const metadata: Metadata = { title: 'Organization' };

export default async function OrganizationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { org, workspaces, members, invitations, limits, isOwner, userId } = await getOrganization(orgId);
  const planName = limits.plan.charAt(0).toUpperCase() + limits.plan.slice(1);
  const count = (used: number, limit: number | null) => (limit === null ? `${used}, no limit` : `${used} of ${limit}`);
  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name }]} title={org.name}>
        <Link href={`/o/${org.id}/billing`} className="eyebrow rounded-sm border border-line px-2 py-1 hover:border-ink hover:text-ink">
          {planName} plan
        </Link>
      </PageHeader>
      <OrgNav orgId={org.id} current="overview" />

      {isOwner && org.terms_version !== TERMS_VERSION ? (
        <form action={acceptTerms} role="note" className="mb-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-diff/45 bg-diff/10 px-4 py-3 text-sm leading-6">
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="version" value={TERMS_VERSION} />
          <span>
            {org.terms_version ? `The Terms of Service changed since this organization accepted the version of ${org.terms_version}.` : 'This organization has not accepted the Terms of Service yet.'}{' '}
            <Link href="/legal/terms" className="underline">Read the terms</Link>, with the <Link href="/legal/dpa" className="underline">DPA</Link> as part of them.
          </span>
          <button className={secondaryButtonClass}>Accept for {org.name}</button>
        </form>
      ) : null}

      <Section
        title="Workspaces"
        description={<>One workspace per customer n8n instance. Runs are uploaded with a workspace token. {planName} plan: workspaces {count(limits.workspaces_used, limits.workspaces)}, run history {limits.retention_days} days.</>}
      >
        {workspaces.length === 0 ? (
          <Empty>No workspaces yet.</Empty>
        ) : (
          <ul className="record-list">
            {/* Oldest first: after a downgrade, the workspaces past the limit are the newest ones. */}
            {workspaces.map((w, i) => (
              <li key={w.id}>
                <Link href={`/w/${w.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 hover:bg-bg">
                  <span className="font-bold">
                    {w.name}
                    {limits.workspaces !== null && i >= limits.workspaces ? <span className="ml-2 text-xs font-normal text-error">over the plan limit, uploads refused</span> : null}
                  </span>
                  <span className="font-mono text-xs text-muted">{[w.instance_host, w.engine_tag && `n8n ${w.engine_tag}`].filter(Boolean).join(' · ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6">
          <ActionForm action={createWorkspace} submit="Create workspace" pending="Creating…">
            <input type="hidden" name="orgId" value={org.id} />
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input name="name" required maxLength={100} placeholder="Customer A" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>n8n host <span className="text-xs text-muted">· optional</span></span>
              <input name="instanceHost" maxLength={255} placeholder="n8n.customer-a.com" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>n8n version <span className="text-xs text-muted">· optional</span></span>
              <input name="engineTag" maxLength={64} placeholder="2.40.5" className={`${inputClass} w-28`} />
            </label>
          </ActionForm>
        </div>
      </Section>

      <Section title="Members" description={`${isOwner ? 'Invited people join when they next sign in with the invited address; invitations expire after 30 days. ' : ''}Seats: ${count(limits.seats_used, limits.seats)}, counting invitations.`}>
        <ul className="record-list">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>{m.email || m.user_id}</span>
              <span className="flex items-center gap-3 text-xs text-muted">
                {m.role}
                {isOwner && m.role !== 'owner' ? (
                  <form action={makeOwner}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="userId" value={m.user_id} />
                    <ConfirmButton confirm={`Make ${m.email || 'them'} an owner`}>Make owner</ConfirmButton>
                  </form>
                ) : null}
                {isOwner && m.user_id !== userId ? (
                  <form action={removeMember}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="userId" value={m.user_id} />
                    <ConfirmButton confirm={`Remove ${m.email || 'member'}`}>Remove</ConfirmButton>
                  </form>
                ) : null}
              </span>
            </li>
          ))}
          {invitations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="text-muted">{i.email}</span>
              <span className="flex items-center gap-3 text-xs text-muted">
                invited <Time value={i.created_at} />
                {isOwner ? (
                  <form action={cancelInvitation}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="invitationId" value={i.id} />
                    <ConfirmButton confirm="Cancel invitation">Cancel</ConfirmButton>
                  </form>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {isOwner ? (
          <div className="mt-6">
            <ActionForm action={inviteMember} submit="Invite" pending="Inviting…">
              <input type="hidden" name="orgId" value={org.id} />
              <label className="flex flex-col gap-1 text-sm">
                Email
                <input name="email" type="email" required placeholder="colleague@agency.com" className={inputClass} />
              </label>
            </ActionForm>
          </div>
        ) : null}
      </Section>
    </>
  );
}
