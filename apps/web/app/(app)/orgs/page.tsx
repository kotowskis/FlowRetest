import type { Metadata } from 'next';
import Link from 'next/link';
import { listOrganizations } from '@/lib/data.ts';
import { ActionForm } from '@/components/forms.tsx';
import { Empty, PageHeader, Section, inputClass } from '@/components/ui.tsx';
import { createOrganization } from '../actions.ts';

export const metadata: Metadata = { title: 'Organizations' };

export default async function OrganizationsPage() {
  const orgs = await listOrganizations();
  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations' }]} title="Organizations" />
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
