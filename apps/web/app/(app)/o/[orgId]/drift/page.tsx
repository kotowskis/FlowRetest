import type { Metadata } from 'next';
import { getOrganizationDrift } from '@/lib/data.ts';
import { DriftHowTo, DriftLocked, WorkspaceDriftTable } from '@/components/drift.tsx';
import { PageHeader, Section } from '@/components/ui.tsx';

export const metadata: Metadata = { title: 'Engine drift' };

export default async function OrganizationDriftPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { org, workspaces, cells, limits } = await getOrganizationDrift(orgId);
  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name, href: `/o/${org.id}` }, { label: 'Engine drift' }]} title="Engine drift" />
      <Section title="Which customer instances can move to which n8n version" description="Per workspace and target version: the latest upgrade-check of each workflow, counted by status. Open a workspace for the workflows behind the numbers.">
        {!limits.drift_matrix ? <DriftLocked plan={limits.plan} billingHref={`/o/${org.id}/billing`} /> : cells.length === 0 ? <DriftHowTo /> : <WorkspaceDriftTable cells={cells} workspaces={workspaces} />}
      </Section>
    </>
  );
}
