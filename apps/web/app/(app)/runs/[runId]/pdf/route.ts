import { NextResponse } from 'next/server';
import type { PlanReport } from '@flowretest/core';
import { getRun, session } from '@/lib/data.ts';
import { env } from '@/lib/env.ts';
import { recordCases, recordFileName } from '@/lib/run-record.ts';
import { renderRunRecord } from '@/lib/pdf/run-record-pdf.ts';
import type { RunSummary } from '@/lib/ingest.ts';

export const dynamic = 'force-dynamic';

const utc = (value: string | null) => (value ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '');

/** "Download PDF" on the run page: the record of what the new version would send, for plans with PDF export. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  // getRun reads through RLS: a run of another organization is a 404 here as on the page.
  const { run, workflow, workspace, org, acceptances } = await getRun(runId);
  const { db } = await session();
  const { data: plan } = await db.rpc('org_plan', { org: org.id });
  if (plan?.[0]?.pdf_export !== true) {
    return NextResponse.json({ error: `PDF export is not part of the ${plan?.[0]?.plan ?? 'current'} plan; see ${env.appUrl()}/o/${org.id}/billing` }, { status: 402 });
  }
  const report = run.report as unknown as PlanReport;
  const pdf = await renderRunRecord({
    runId: run.id,
    runUrl: `${env.appUrl()}/runs/${run.id}`,
    status: run.status,
    mode: run.mode,
    workflowName: workflow.name,
    n8nWorkflowId: workflow.n8n_workflow_id,
    workspaceName: workspace.name,
    organizationName: org.name,
    oldLabel: run.old_label,
    newLabel: run.new_label,
    engineImage: run.engine_image,
    runner: run.runner,
    generatedAt: utc(run.generated_at),
    uploadedAt: utc(run.created_at),
    sealed: run.sealed,
    localRun: run.local_run,
    commit: run.git_repository && run.git_sha ? { repository: run.git_repository, sha: run.git_sha, pullRequest: run.pull_request } : undefined,
    coverage: report.coverage,
    summary: run.summary as unknown as RunSummary & Record<string, number>,
    acceptances: [...acceptances].reverse().map((a) => ({ acceptedBy: a.accepted_by_email || 'unknown', at: utc(a.created_at), cases: a.case_ids, message: a.message, appliedAt: a.applied_at ? utc(a.applied_at) : null })),
    cases: recordCases(report),
    printedAt: utc(new Date().toISOString()),
  });
  const name = recordFileName(workflow.name, run.status, run.created_at);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
    },
  });
}
