import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrganizationData } from '@/lib/data.ts';
import { DPA_VERSION, dpaAcceptanceOpen } from '@/lib/legal/documents.ts';
import { provider } from '@/lib/legal/provider.ts';
import { changeLine } from '@/lib/subprocessor-notices.ts';
import { DraftNotice } from '@/components/legal.tsx';
import { ActionForm } from '@/components/forms.tsx';
import { Empty, OrgNav, PageHeader, Section, Time, inputClass, secondaryButtonClass } from '@/components/ui.tsx';
import { acceptDpa, deleteOrganization, setRetention } from './actions.ts';

export const metadata: Metadata = { title: 'Data' };

/** The acceptance form; a second acceptance of the same version corrects the details of the first. */
function acceptForm(orgId: string) {
  return (
    <ActionForm action={acceptDpa} submit="Accept the DPA" pending="Recording…" className="grid gap-3 sm:grid-cols-2 sm:items-end">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="version" value={DPA_VERSION} />
      <label className="flex flex-col gap-1 text-sm">
        Company name
        <input name="companyName" required maxLength={200} placeholder="Acme Automation Sp. z o.o." className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Registration or VAT number <span className="text-xs text-muted">· optional</span></span>
        <input name="companyId" maxLength={100} placeholder="PL1234567890" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Registered address
        <input name="companyAddress" required maxLength={500} placeholder="ul. Przykładowa 1, 00-001 Warszawa, Poland" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Your name
        <input name="signerName" required maxLength={200} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Your role
        <input name="signerRole" required maxLength={200} placeholder="Managing director" className={inputClass} />
      </label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input name="authority" type="checkbox" required className="mt-1" />
        <span>I have read the DPA and may accept agreements for this company.</span>
      </label>
    </ActionForm>
  );
}

export default async function OrganizationDataPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { org, isOwner, limits, dpa, workspaces, runCount, upcoming } = await getOrganizationData(orgId);
  const planName = limits.plan.charAt(0).toUpperCase() + limits.plan.slice(1);
  const effective = org.retention_days === null ? limits.retention_days : Math.min(org.retention_days, limits.retention_days);
  const current = dpa.find((a) => a.version === DPA_VERSION);
  const legal = provider();
  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name, href: `/o/${org.id}` }, { label: 'Data' }]} title="Data and privacy" />
      <OrgNav orgId={org.id} current="data" />

      <Section
        title="Run history"
        description={
          <>
            Runs older than {effective} days are deleted every night at 03:17 UTC. The {planName} plan keeps them {limits.retention_days} days
            {org.retention_days === null ? '' : `; this organization asked for ${org.retention_days}`}. Acceptances stay as long as the workspace. <Link href="/legal/retention" className="underline">Data retention</Link> lists everything the service keeps.
          </>
        }
      >
        {isOwner ? (
          <ActionForm action={setRetention} submit="Save" pending="Saving…">
            <input type="hidden" name="orgId" value={org.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span>Keep runs for (days) <span className="text-xs text-muted">· empty follows the plan</span></span>
              <input name="days" type="number" min={1} max={3650} defaultValue={org.retention_days ?? ''} placeholder={String(limits.retention_days)} className={`${inputClass} w-32`} />
            </label>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">Owners can set a shorter history.</p>
        )}
      </Section>

      <Section
        title="Data Processing Agreement"
        description={
          <>
            The <Link href="/legal/dpa" className="underline">DPA</Link> (version of {DPA_VERSION}, also <Link href="/legal/dpa?lang=pl" className="underline">in Polish</Link>) sets how FlowRetest processes personal data for this organization. An owner accepts it for the company; each acceptance is kept with a PDF copy. Owners of every organization get an email at least 30 days before a sub-processor changes.
          </>
        }
      >
        {upcoming.length > 0 ? (
          <div role="note" className="mb-4 rounded-md border border-diff/45 bg-diff/10 px-4 py-3 text-sm leading-6">
            <p className="font-medium">Announced sub-processor changes</p>
            <ul className="mt-1 list-disc pl-5">
              {upcoming.map((n) => (
                <li key={n.id}>
                  On {n.effective_on}: {n.changes.map(changeLine).join('; ')}. <Link href="/legal/subprocessors" className="underline">Details</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {dpa.length === 0 ? (
          <Empty>Not accepted yet.</Empty>
        ) : (
          <ul className="record-list">
            {dpa.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{a.company_name}</span>
                  <span className="text-muted"> · {a.signer_name}, {a.signer_role} · version {a.version}{a.version !== DPA_VERSION ? ' (older)' : a.id === current?.id ? '' : ' (replaced by a later acceptance)'}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  <Time value={a.accepted_at} />
                  <a href={`/o/${org.id}/dpa/${a.id}/pdf`} className="underline">PDF</a>
                  <a href={`/o/${org.id}/dpa/${a.id}/pdf?lang=pl`} className="underline" title="Polish translation">PDF (PL)</a>
                </span>
              </li>
            ))}
          </ul>
        )}
        {isOwner && !current && legal.draft ? <div className="mt-6"><DraftNotice complete={legal.complete} /></div> : null}
        {isOwner && current && dpaAcceptanceOpen(legal) ? (
          // Acceptances are never edited; a typo in the company name is fixed by a new acceptance, which becomes current.
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted underline">Wrong company or signer details? Accept again with the right ones</summary>
            <div className="mt-4">{acceptForm(org.id)}</div>
          </details>
        ) : null}
        {isOwner && !current && dpaAcceptanceOpen(legal) ? <div className="mt-6">{acceptForm(org.id)}</div> : null}
      </Section>

      <Section
        title="Export"
        description={`Everything the service keeps for this organization as one JSON Lines file: members, invitations, ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}, ${runCount} run${runCount === 1 ? '' : 's'} with their redacted reports, acceptances, checks, notifications, DPA acceptances, invoices, the upload counter and the sub-processor emails sent to its owners. The last line counts the lines before it, so a download cut short shows.`}
      >
        {isOwner ? (
          <a href={`/o/${org.id}/export`} className={secondaryButtonClass}>Download export</a>
        ) : (
          <p className="text-sm text-muted">Owners can download the export.</p>
        )}
      </Section>

      {isOwner ? (
        <Section title="Delete the organization" description="Deletes every workspace, run, acceptance and token of this organization at once; backups lose them within 7 days. A subscription that still renews has to be cancelled on the Billing page first. Stripe keeps the invoices.">
          <ActionForm action={deleteOrganization} submit="Delete organization" pending="Deleting…">
            <input type="hidden" name="orgId" value={org.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span>Type <span className="font-mono">{org.name}</span> to confirm</span>
              <input name="confirm" required autoComplete="off" className={inputClass} />
            </label>
          </ActionForm>
        </Section>
      ) : null}
    </>
  );
}
