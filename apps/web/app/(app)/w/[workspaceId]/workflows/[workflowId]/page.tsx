import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWorkflow } from '@/lib/data.ts';
import type { RunSummary } from '@/lib/ingest.ts';
import { AcceptanceList, Empty, PageHeader, Section, StatusBadge, Time } from '@/components/ui.tsx';

export const metadata: Metadata = { title: 'Workflow runs' };

function changes(summary: RunSummary): string {
  const parts = [summary.changed && `${summary.changed} changed`, summary.added && `${summary.added} added`, summary.removed && `${summary.removed} removed`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no call changes';
}

export default async function WorkflowPage({ params }: { params: Promise<{ workspaceId: string; workflowId: string }> }) {
  const { workspaceId, workflowId } = await params;
  const { workflow, workspace, org, runs, acceptances } = await getWorkflow(workflowId);
  if (workspace.id !== workspaceId) notFound();
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name, href: `/o/${org.id}` }, { label: workspace.name, href: `/w/${workspace.id}` }, { label: workflow.name }]}
        title={workflow.name}
      >
        <span className="font-mono text-sm text-muted">n8n id {workflow.n8n_workflow_id}</span>
      </PageHeader>
      <Section title="Runs" description={runs.length >= 100 ? 'The latest 100 runs.' : undefined}>
        {runs.length === 0 ? (
          <Empty>No runs uploaded for this workflow.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-panel">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Uploaded</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Cases</th>
                  <th className="px-4 py-2 font-medium">Calls</th>
                  <th className="px-4 py-2 font-medium">Compared</th>
                  <th className="px-4 py-2 font-medium">Engine</th>
                  <th className="px-4 py-2 font-medium"><span className="sr-only">Compare</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r, i) => {
                  const summary = r.summary as unknown as RunSummary;
                  // Runs are newest first, so the previous run is the next row.
                  const previous = runs[i + 1];
                  return (
                    <tr key={r.id} className="hover:bg-bg">
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Link href={`/runs/${r.id}`} className="hover:underline"><Time value={r.created_at} /></Link>
                      </td>
                      <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {summary.cases} ({['PASS', 'DIFF', 'ERROR', 'BLOCKED', 'SKIPPED'].filter((s) => summary[s as keyof RunSummary]).map((s) => `${summary[s as keyof RunSummary]} ${s}`).join(', ')})
                      </td>
                      <td className="px-4 py-2 text-muted">{changes(summary)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted">{r.mode === 'upgrade' ? 'engine upgrade' : `${r.old_label} → ${r.new_label}`}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted">{r.engine_image}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">
                        {previous ? <Link href={`/w/${workspace.id}/workflows/${workflow.id}/compare?a=${previous.id}&b=${r.id}`} className="text-muted hover:underline">vs previous</Link> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="Acceptances" description="Who made which change the new baseline, and whether a runner has written it.">
        <AcceptanceList rows={acceptances} showRun />
      </Section>
    </>
  );
}
