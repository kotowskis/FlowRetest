import type { Metadata } from 'next';
import Link from 'next/link';
import type { PlanReport } from '@flowretest/core';
import { getRun } from '@/lib/data.ts';
import { ReportView } from '@/components/report-view.tsx';
import { PageHeader, StatusBadge, Time } from '@/components/ui.tsx';

export const metadata: Metadata = { title: 'Run' };

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { run, workflow, workspace, org, previous } = await getRun(runId);
  // Stored as uploaded after RedactedReportSchema validation; it has every field the plan renderer reads.
  const report = run.report as unknown as PlanReport;
  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Organizations', href: '/orgs' },
          { label: org.name, href: `/o/${org.id}` },
          { label: workspace.name, href: `/w/${workspace.id}` },
          { label: workflow.name, href: `/w/${workspace.id}/workflows/${workflow.id}` },
          { label: 'run' },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={run.status} />
            {workflow.name}
          </span>
        }
      >
        {previous ? (
          <Link href={`/runs/${previous.id}`} className="text-sm text-muted hover:text-ink hover:underline">
            ← previous run ({previous.status})
          </Link>
        ) : null}
      </PageHeader>
      <dl className="mb-8 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">Compared</dt>
        <dd className="font-mono break-all">{run.mode === 'upgrade' ? `${run.old_label} → ${run.new_label}` : `old: ${run.old_label} → new: ${run.new_label}`}</dd>
        <dt className="text-muted">Engine</dt>
        <dd className="font-mono break-all">{run.engine_image}</dd>
        <dt className="text-muted">Generated</dt>
        <dd>
          <Time value={run.generated_at} /> by FlowRetest {run.runner}
          {run.local_run ? <span className="text-muted"> · local run <code className="font-mono">{run.local_run}</code></span> : null}
        </dd>
        <dt className="text-muted">Uploaded</dt>
        <dd><Time value={run.created_at} /></dd>
      </dl>
      <ReportView report={report} />
      <p className="mt-10 text-xs text-muted">
        Values appear as shapes: type, length and a hash that is equal only for equal values inside this report. The full report stays on the machine that ran it
        {run.local_run ? <> (<code className="font-mono">.flowretest/{workflow.n8n_workflow_id}/runs/{run.local_run}/report.json</code>)</> : null}.
      </p>
    </>
  );
}
