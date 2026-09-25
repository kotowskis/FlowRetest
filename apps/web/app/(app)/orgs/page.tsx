import type { Metadata } from 'next';
import Link from 'next/link';
import { listOrganizations } from '@/lib/data.ts';
import { ActionForm } from '@/components/forms.tsx';
import { Empty, PageHeader, Section, inputClass } from '@/components/ui.tsx';
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
      {githubMessage ? <p role="status" className="mb-6 text-sm text-muted">{githubMessage}</p> : null}
      <Section title="Your organizations">
        {orgs.length === 0 ? (
          <Empty>You are not in any organization yet. Create one below, or ask an owner to invite this email address.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-panel">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={`/o/${o.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-bg">
                  <span className="font-medium">{o.name}</span>
                  <span className="text-xs text-muted">{o.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="New organization" description="Usually one per agency. Each customer instance becomes a workspace inside it.">
        <ActionForm action={createOrganization} submit="Create organization" pending="Creating…">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" required maxLength={100} placeholder="Acme Automation" className={inputClass} />
          </label>
        </ActionForm>
      </Section>
    </>
  );
}
