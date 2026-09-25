import type { Metadata } from 'next';
import Link from 'next/link';
import { listOrganizations, session } from '@/lib/data.ts';
import { ActionForm } from '@/components/forms.tsx';
import { PageHeader, Section, inputClass } from '@/components/ui.tsx';
import { deleteAccount } from './actions.ts';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const { user } = await session();
  const orgs = await listOrganizations();
  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: 'Account' }]} title="Account" />
      <Section title="Your data" description="The service keeps your email address, your sign-in times and your memberships. Acceptances you made stay in the history of their workspaces with your address.">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted">Email</dt>
          <dd className="break-all">{user.email}</dd>
          <dt className="text-muted">Organizations</dt>
          <dd>
            {orgs.length === 0
              ? 'none'
              : orgs.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 ? ', ' : ''}
                    <Link href={`/o/${o.id}`} className="underline">{o.name}</Link> ({o.role})
                  </span>
                ))}
          </dd>
        </dl>
        <p className="mt-4 text-sm text-muted">
          Owners export the data of an organization on its Data page. <Link href="/legal/privacy" className="underline">Privacy notice</Link>
        </p>
      </Section>
      <Section
        title="Delete the account"
        description="Organizations where you are the only member are deleted with it. If you are the only owner of an organization with other members, make one of them an owner first. A running subscription has to be cancelled first."
      >
        <ActionForm action={deleteAccount} submit="Delete account" pending="Deleting…">
          <label className="flex flex-col gap-1 text-sm">
            <span>Type <span className="font-mono">{user.email}</span> to confirm</span>
            <input name="confirm" required autoComplete="off" className={inputClass} />
          </label>
        </ActionForm>
      </Section>
    </>
  );
}
