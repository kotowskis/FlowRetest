import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrganizationData } from '@/lib/data.ts';
import { DPA_VERSION, dpaAcceptanceOpen } from '@/lib/legal/documents.ts';
import { provider } from '@/lib/legal/provider.ts';
import { changeLine } from '@/lib/subprocessor-notices.ts';
import { DraftNotice } from '@/components/legal.tsx';
import { ActionForm } from '@/components/forms.tsx';
import { Empty, PageHeader, Section, Time, inputClass } from '@/components/ui.tsx';
import { acceptDpa, deleteOrganization, setRetention } from './actions.ts';

export const metadata: Metadata = { title: 'Data' };

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
            The <Link href="/legal/dpa" className="underline">DPA</Link> (version of {DPA_VERSION}, also <Link href="/legal/dpa?lang=pl" className="underline">in Polish</Link>) sets how FlowRetest processes personal data for this organization. An owner accepts it for the company; each acceptance is kept with a PDF copy. Owners of organizations that accepted it get an email 30 days before a sub-processor changes.
          </>
        }
      >
        {upcoming.length > 0 ? (
          <div role="note" className="mb-4 rounded-md border border-diff/40 bg-diff/10 px-4 py-3 text-sm">
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
          <ul className="divide-y divide-line rounded-md border border-line bg-panel">
            {dpa.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{a.company_name}</span>
                  <span className="text-muted"> · {a.signer_name}, {a.signer_role} · version {a.version}{a.version === DPA_VERSION ? '' : ' (older)'}</span>
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
        {isOwner && !current && legal.draft ? <div className="mt-6"><DraftNotice /></div> : null}
        {isOwner && !current && dpaAcceptanceOpen(legal) ? (
          <div className="mt-6">
            <ActionForm action={acceptDpa} submit="Accept the DPA" pending="Recording…" className="grid gap-3 sm:grid-cols-2 sm:items-end">
              <input type="hidden" name="orgId" value={org.id} />
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
          </div>
        ) : null}
      </Section>

      <Section
        title="Export"
        description={`Everything the service keeps for this organization as one JSON Lines file: members, invitations, ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}, ${runCount} run${runCount === 1 ? '' : 's'} with their redacted reports, acceptances, checks, notifications, DPA acceptances and invoices.`}
      >
        {isOwner ? (
          <a href={`/o/${org.id}/export`} className="inline-block rounded-md border border-line px-3 py-2 text-sm hover:bg-bg">Download export</a>
        ) : (
          <p className="text-sm text-muted">Owners can download the export.</p>
        )}
      </Section>

      {isOwner ? (
        <Section title="Delete the organization" description="Deletes every workspace, run, acceptance and token of this organization at once; backups lose them within 7 days. A running subscription has to be cancelled on the Billing page first. Stripe keeps the invoices.">
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
