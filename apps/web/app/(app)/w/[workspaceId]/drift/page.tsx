import type { Metadata } from 'next';
import { getWorkspaceDrift } from '@/lib/data.ts';
import { DriftHowTo, DriftLocked, WorkflowDriftTable } from '@/components/drift.tsx';
import { PageHeader, Section } from '@/components/ui.tsx';

export const metadata: Metadata = { title: 'Engine drift' };

export default async function WorkspaceDriftPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { workspace, org, cells, workflows, limits } = await getWorkspaceDrift(workspaceId);
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name, href: `/o/${org.id}` }, { label: workspace.name, href: `/w/${workspace.id}` }, { label: 'Engine drift' }]}
        title="Engine drift"
      >
        {workspace.engine_tag ? <span className="font-mono text-sm text-muted">runs n8n {workspace.engine_tag}</span> : null}
      </PageHeader>
      <Section title="What changes after an n8n upgrade" description="The latest upgrade-check of each workflow against each target version: PASS means the new engine sends the same calls; DIFF, ERROR and BLOCKED link to the plan.">
        {!limits.drift_matrix ? <DriftLocked plan={limits.plan} billingHref={`/o/${org.id}/billing`} /> : cells.length === 0 ? <DriftHowTo /> : <WorkflowDriftTable cells={cells} workflows={workflows} />}
      </Section>
    </>
  );
}
