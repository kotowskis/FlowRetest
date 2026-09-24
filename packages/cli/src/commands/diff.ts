import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkExpectations, diffCase, exitCodeFor, withExpectations, fromBaseline, maskVolatile, overallStatus, renderFormat, type CaseDiff, type PlanFormat, type PlanReport } from '@flowretest/core';
import { loadConfig, workflowDir } from '../config.ts';
import { loadBaseline, loadReport } from './report-files.ts';
import { loadExpectations } from '../stubs.ts';

export interface DiffOptions {
  cwd: string;
  workflowId: string;
  run?: string;
  against: 'old' | 'baseline';
  json?: boolean;
  /** terminal (printed), json (printed), junit and md (written into the run directory). Default: terminal. */
  formats?: PlanFormat[];
  log: (line: string) => void;
}

/** "n8nio/n8n:2.40.5" -> "2.40.5". */
function tagOf(image: string): string {
  return image.slice(image.lastIndexOf(':') + 1);
}

/** Files `diff --format` writes into the run directory; the baseline variant keeps the files of `run` intact. */
export function diffFileNames(against: 'old' | 'baseline'): { junit: string; md: string } {
  return against === 'baseline' ? { junit: 'junit.baseline.xml', md: 'plan.baseline.md' } : { junit: 'junit.xml', md: 'plan.md' };
}

/** Re-renders a saved run, optionally against the accepted baselines instead of the old version. */
export function runDiff(options: DiffOptions): { plan: string; exitCode: number; cases: CaseDiff[]; files: string[] } {
  loadConfig(options.cwd);
  const { run, report } = loadReport(options.cwd, options.workflowId, options.run);
  let cases = report.cases;
  let oldLabel = report.old;
  if (options.against === 'baseline') {
    oldLabel = 'accepted baseline';
    // Expectations are checked against the new version's calls again, so an edited expectations.yml applies here too.
    const expectations = loadExpectations(options.cwd, options.workflowId);
    cases = report.cases.map((c) => {
      const baseline = loadBaseline(options.cwd, options.workflowId, c.caseId);
      const calls = report.calls[c.caseId];
      if (c.status === 'SKIPPED') return c;
      // Without a baseline (or without the calls of the run) the case was not compared at all, so it cannot keep the status it had against the old version.
      if (!baseline) return { ...c, status: 'ERROR' as const, error: `no baseline for case ${c.caseId}; run \`flowretest accept\` first` };
      if (!calls) return { ...c, status: 'ERROR' as const, error: `the run has no recorded calls for case ${c.caseId}; run it again` };
      const volatile = [...new Set([...baseline.volatilePaths, ...calls.volatile])];
      // Case warnings (stale AI replay, stubs, input mismatch) describe the run, so they carry over.
      const d = { ...diffCase(c.caseId, maskVolatile(fromBaseline(baseline), volatile), maskVolatile(calls.new, volatile), { newError: c.error }), ...(c.warnings ? { warnings: c.warnings } : {}) };
      return withExpectations(d, checkExpectations(expectations, c.caseId, calls.new));
    });
  }
  const planReport: PlanReport = { runner: report.runner, workflowName: report.workflowName ?? report.workflowId, workflowId: report.workflowId, engine: report.engine, oldLabel, newLabel: report.new, cases, coverage: report.coverage, sealed: report.sandbox?.sealed === true, static: report.static, ...(report.mode === 'upgrade' && report.engines ? { upgrade: { engineOld: tagOf(report.engines.old), engineNew: tagOf(report.engines.new) } } : {}) };
  const plan = renderFormat(planReport, 'terminal');
  const status = overallStatus(cases);
  const formats = options.formats ?? ['terminal'];
  const runDir = join(workflowDir(options.cwd, options.workflowId), 'runs', run);
  const names = diffFileNames(options.against);
  const files: string[] = [];
  if (formats.includes('junit')) {
    files.push(join(runDir, names.junit));
    writeFileSync(files[files.length - 1] as string, renderFormat(planReport, 'junit'));
  }
  if (formats.includes('md')) {
    files.push(join(runDir, names.md));
    writeFileSync(files[files.length - 1] as string, renderFormat(planReport, 'md') + '\n');
  }
  if (options.json || formats.includes('json')) options.log(JSON.stringify({ run, against: options.against, status, cases }, null, 2));
  else if (formats.includes('terminal')) options.log(`Run ${run}\n${plan}`);
  for (const f of files) options.log(`wrote ${f}`);
  return { plan, exitCode: exitCodeFor(status), cases, files };
}
