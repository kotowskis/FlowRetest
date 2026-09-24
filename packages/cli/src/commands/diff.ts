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
      if (!baseline || !calls) return { ...c, status: c.status === 'SKIPPED' ? 'SKIPPED' : c.status, error: baseline ? c.error : `no baseline for case ${c.caseId}; run \`flowretest accept\`` };
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
