import { overallStatus, redactionProblems, type CaseDiff } from '@flowretest/core';
import { RedactedReportSchema, type RedactedReport } from '@flowretest/schemas';

/** Largest body POST /api/runs accepts; the CLI checks the same limit before sending. */
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

export type RunStatus = 'PASS' | 'DIFF' | 'ERROR' | 'BLOCKED';

export interface RunSummary {
  cases: number;
  PASS: number;
  DIFF: number;
  ERROR: number;
  BLOCKED: number;
  SKIPPED: number;
  changed: number;
  added: number;
  removed: number;
  blocked: number;
}

/** Arguments of `ingest_run()` apart from the token hash. */
export interface IngestRow {
  p_n8n_workflow_id: string;
  p_workflow_name: string;
  p_status: RunStatus;
  p_mode: 'change' | 'upgrade';
  p_runner: string;
  p_engine_image: string;
  p_old_label: string;
  p_new_label: string;
  p_sealed: boolean;
  /** Run directory on the runner's machine; empty when unknown. */
  p_local_run: string;
  p_summary: RunSummary;
  p_report: RedactedReport;
  p_report_bytes: number;
  p_generated_at: string;
}

export type IngestResult = { ok: true; row: IngestRow } | { ok: false; status: 400 | 413 | 422; error: string; details?: string[] };

export function summarize(cases: CaseDiff[]): RunSummary {
  const out: RunSummary = { cases: cases.length, PASS: 0, DIFF: 0, ERROR: 0, BLOCKED: 0, SKIPPED: 0, changed: 0, added: 0, removed: 0, blocked: 0 };
  for (const c of cases) {
    out[c.status] += 1;
    out.changed += c.summary.changed;
    out.added += c.summary.added;
    out.removed += c.summary.removed;
    out.blocked += c.summary.blocked;
  }
  return out;
}

/**
 * Checks an uploaded body and turns it into the row to store. The status is computed here from the cases, never
 * taken from the client, and a report that still carries values is refused (422) whatever its `redacted` flag says.
 */
export function prepareIngest(body: string): IngestResult {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_REPORT_BYTES) return { ok: false, status: 413, error: `report is ${bytes} bytes, the limit is ${MAX_REPORT_BYTES}` };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, error: 'body is not JSON' };
  }
  const parsed = RedactedReportSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { ok: false, status: 400, error: 'body is not a redacted FlowRetest report (run `flowretest upload`, not a raw report.json)', details };
  }
  const report = parsed.data;
  // No cases means nothing was tested; stored, it would read as PASS and post a green check.
  if (report.cases.length === 0) return { ok: false, status: 422, error: 'report has no cases; nothing was tested' };
  const problems = redactionProblems(report as Parameters<typeof redactionProblems>[0]);
  if (problems.length > 0) return { ok: false, status: 422, error: 'report still carries values; only reports written by `flowretest redact --report` are accepted', details: problems };
  const generatedAt = Number.isNaN(Date.parse(report.generatedAt)) ? new Date().toISOString() : new Date(report.generatedAt).toISOString();
  return {
    ok: true,
    row: {
      p_n8n_workflow_id: report.workflowId,
      p_workflow_name: report.workflowName || report.workflowId,
      p_status: overallStatus(report.cases as CaseDiff[]) as RunStatus,
      p_mode: report.upgrade ? 'upgrade' : 'change',
      p_runner: report.runner,
      p_engine_image: report.engine.image,
      p_old_label: report.oldLabel,
      p_new_label: report.newLabel,
      p_sealed: report.sealed,
      p_local_run: report.run ?? '',
      p_summary: summarize(report.cases as CaseDiff[]),
      p_report: report,
      p_report_bytes: bytes,
      p_generated_at: generatedAt,
    },
  };
}
