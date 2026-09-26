import type { Metadata } from 'next';
import Link from 'next/link';
import { listOrganizations } from '@/lib/data.ts';
import { ActionForm } from '@/components/forms.tsx';
import { Empty, Notice, PageHeader, Section, inputClass } from '@/components/ui.tsx';
import { createOrganization } from '../actions.ts';

export const metadata: Metadata = { title: 'Organizations' };

/** GitHub sends people here when a callback carries no state of ours (?github=). */
const GITHUB_MESSAGES: Record<string, string> = {
  expired: 'The GitHub link expired or did not start here. Connect GitHub again from the workspace page.',
  updated: 'The GitHub installation changed. To send checks to newly added repositories, an admin of them connects GitHub again from the workspace page.',
};

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ github?: string; deleted?: string }> }) {
  const orgs = await listOrganizations();
  const { github, deleted } = await searchParams;
  const githubMessage = github ? GITHUB_MESSAGES[github] : deleted === 'organization' ? 'The organization and all its data were deleted.' : undefined;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations' }]} title="Organizations" />
      {githubMessage ? <Notice>{githubMessage}</Notice> : null}
      <Section title="Your organizations">
        {orgs.length === 0 ? (
          <Empty>You are not in any organization yet. Create one below, or ask an owner to invite this email address.</Empty>
        ) : (
          <ul className="record-list">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={`/o/${o.id}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-bg">
                  <span className="font-bold">{o.name}</span>
                  <span className="eyebrow">{o.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="New organization" description="Usually one per agency. Each customer instance becomes a workspace inside it.">
        <ActionForm action={createOrganization} submit="Create organization" pending="Creating…" className="grid max-w-md justify-items-start gap-4">
          <label className="flex w-full flex-col gap-1.5 text-sm font-bold">
            Name
            <input name="name" required maxLength={100} placeholder="Acme Automation" className={`${inputClass} font-normal`} />
          </label>
          <label className="flex items-start gap-2.5 text-sm leading-6">
            <input name="terms" type="checkbox" required className="mt-1 size-4 shrink-0" />
            <span>
              I accept the <Link href="/legal/terms" className="underline">Terms of Service</Link>, with the <Link href="/legal/dpa" className="underline">DPA</Link> as part of them, for this organization.
            </span>
          </label>
        </ActionForm>
      </Section>
    </>
  );
}
