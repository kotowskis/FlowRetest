import { diffCase, exitCodeFor, fromBaseline, maskVolatile, overallStatus, renderPlan, type CaseDiff } from '@flowretest/core';
import { loadConfig } from '../config.ts';
import { loadBaseline, loadReport } from './report-files.ts';

export interface DiffOptions {
  cwd: string;
  workflowId: string;
  run?: string;
  against: 'old' | 'baseline';
  json?: boolean;
  log: (line: string) => void;
}

/** Re-renders a saved run, optionally against the accepted baselines instead of the old version. */
export function runDiff(options: DiffOptions): { plan: string; exitCode: number; cases: CaseDiff[] } {
  loadConfig(options.cwd);
  const { run, report } = loadReport(options.cwd, options.workflowId, options.run);
  let cases = report.cases;
  let oldLabel = report.old;
  if (options.against === 'baseline') {
    oldLabel = 'accepted baseline';
    cases = report.cases.map((c) => {
      const baseline = loadBaseline(options.cwd, options.workflowId, c.caseId);
      const calls = report.calls[c.caseId];
      if (c.status === 'SKIPPED') return c;
      // Without a baseline (or without the calls of the run) the case was not compared at all, so it cannot keep the status it had against the old version.
      if (!baseline) return { ...c, status: 'ERROR' as const, error: `no baseline for case ${c.caseId}; run \`flowretest accept\` first` };
      if (!calls) return { ...c, status: 'ERROR' as const, error: `the run has no recorded calls for case ${c.caseId}; run it again` };
      const volatile = [...new Set([...baseline.volatilePaths, ...calls.volatile])];
      return diffCase(c.caseId, maskVolatile(fromBaseline(baseline), volatile), maskVolatile(calls.new, volatile), { newError: c.error });
    });
  }
  const plan = renderPlan({ runner: report.runner, workflowName: report.workflowName ?? report.workflowId, workflowId: report.workflowId, engine: report.engine, oldLabel, newLabel: report.new, cases, coverage: report.coverage, sealed: true });
  const status = overallStatus(cases);
  if (options.json) options.log(JSON.stringify({ run, against: options.against, status, cases }, null, 2));
  else options.log(`Run ${run}\n${plan}`);
  return { plan, exitCode: exitCodeFor(status), cases };
}
