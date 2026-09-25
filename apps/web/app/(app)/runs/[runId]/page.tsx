import type { Metadata } from 'next';
import Link from 'next/link';
import type { PlanReport } from '@flowretest/core';
import { getRun } from '@/lib/data.ts';
import { ReportView } from '@/components/report-view.tsx';
import { AcceptanceList, PageHeader, Section, StatusBadge, Time, quietButtonClass } from '@/components/ui.tsx';
import { deleteRun } from '../../actions.ts';
import { AcceptForm, type AcceptableCase } from '@/components/acceptance.tsx';
import { acceptRun } from '../../actions.ts';

export const metadata: Metadata = { title: 'Run' };

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { run, workflow, workspace, org, previous, acceptances, check, pdfExport, isOwner } = await getRun(runId);
  // Stored as uploaded after RedactedReportSchema validation; it has every field the plan renderer reads.
  const report = run.report as unknown as PlanReport & { stability?: Record<string, boolean> };
  // The same rule as `flowretest accept` without --force; accept_run checks it again on the server.
  const cases: AcceptableCase[] = report.cases.map((c) => ({
    caseId: c.caseId,
    status: c.status,
    blocked: c.status !== 'PASS' && c.status !== 'DIFF' ? 'only PASS and DIFF cases' : report.stability?.[c.caseId] === true ? undefined : report.stability?.[c.caseId] === false ? 'differs between two runs; mask the changing fields first' : 'not checked for stability: run with --stabilize and upload again',
  }));
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
        <span className="flex flex-wrap items-center gap-4 text-sm">
          {previous ? (
            <Link href={`/runs/${previous.id}`} className="text-muted hover:text-ink hover:underline">
              ← previous run ({previous.status})
            </Link>
          ) : null}
          {pdfExport ? (
            // A plain link: the route answers with a file, not a page.
            <a href={`/runs/${run.id}/pdf`} className="rounded-md border border-line px-2 py-1 text-xs hover:text-ink">Download PDF record</a>
          ) : (
            <Link href={`/o/${org.id}/billing`} className="text-xs text-muted hover:text-ink hover:underline" title="The PDF record of what this run would send comes with the Agency plan">
              PDF record comes with Agency
            </Link>
          )}
          {isOwner ? (
            <form action={deleteRun}>
              <input type="hidden" name="runId" value={run.id} />
              <button className={quietButtonClass} title="Deletes this run now; its acceptances stay in the history">Delete run</button>
            </form>
          ) : null}
        </span>
      </PageHeader>
      <dl className="mb-8 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">Compared</dt>
        <dd className="font-mono break-all">{run.mode === 'upgrade' ? `${run.old_label} → ${run.new_label}` : `old: ${run.old_label} → new: ${run.new_label}`}</dd>
        {run.workflow_version_id ? (
          <>
            <dt className="text-muted">Workflow version</dt>
            <dd className="font-mono break-all">{run.workflow_version_id}</dd>
          </>
        ) : null}
        <dt className="text-muted">Engine</dt>
        <dd className="font-mono break-all">{run.engine_image}</dd>
        <dt className="text-muted">Generated</dt>
        <dd>
          <Time value={run.generated_at} /> by FlowRetest {run.runner}
          {run.local_run ? <span className="text-muted"> · local run <code className="font-mono">{run.local_run}</code></span> : null}
        </dd>
        <dt className="text-muted">Uploaded</dt>
        <dd><Time value={run.created_at} /></dd>
        {run.git_repository && run.git_sha ? (
          <>
            <dt className="text-muted">Commit</dt>
            <dd className="font-mono break-all">
              {run.git_repository}@{run.git_sha.slice(0, 7)}
              {run.pull_request ? <span className="text-muted"> · pull request #{run.pull_request}</span> : null}
              {check ? (
                check.ok && check.html_url ? (
                  <> · <a href={check.html_url} className="text-accent hover:underline">GitHub check ({check.conclusion})</a></>
                ) : (
                  <span className="font-sans text-diff"> · no GitHub check: {check.detail}</span>
                )
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
      <ReportView report={report} />
      <div className="mt-10">
        <Section title="Accept" description="Makes the new version's calls of these cases the baseline that later runs are compared with.">
          <AcceptForm action={acceptRun} runId={run.id} cases={cases} localRun={run.local_run} />
        </Section>
        {acceptances.length > 0 ? (
          <Section title="Acceptances of this run">
            <AcceptanceList rows={acceptances} />
          </Section>
        ) : null}
      </div>
      <p className="mt-10 text-xs text-muted">
        Values appear as shapes: type, length and a hash that is equal only for equal values inside this report. The full report stays on the machine that ran it
        {run.local_run ? <> (<code className="font-mono">.flowretest/{workflow.n8n_workflow_id}/runs/{run.local_run}/report.json</code>)</> : null}.
      </p>
    </>
  );
}
