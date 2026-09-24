import { toBaseline } from '@flowretest/core';
import { loadConfig } from '../config.ts';
import { CLI_VERSION } from '../index.ts';
import { loadReport, saveBaseline } from './report-files.ts';

export interface AcceptOptions {
  cwd: string;
  workflowId: string;
  run?: string;
  cases?: string[];
  message?: string;
  log: (line: string) => void;
}

/**
 * Writes the new version's register of a run as the accepted baseline per case.
 * Stability (two identical runs of the new version) is the caller's job in 0.1:
 * run with --stabilize so volatile fields are already masked.
 */
export function runAccept(options: AcceptOptions): string[] {
  loadConfig(options.cwd);
  const { run, report } = loadReport(options.cwd, options.workflowId, options.run);
  const written: string[] = [];
  for (const c of report.cases) {
    if (options.cases && !options.cases.includes(c.caseId)) continue;
    if (c.status === 'SKIPPED' || c.status === 'ERROR' || c.status === 'BLOCKED') {
      options.log(`case ${c.caseId}: ${c.status}, not accepted`);
      continue;
    }
    const calls = report.calls[c.caseId];
    if (!calls) continue;
    const baseline = toBaseline(c.caseId, calls.new, {
      acceptedAt: new Date().toISOString(),
      acceptedBy: process.env.USERNAME ?? process.env.USER,
      message: options.message,
      engineDigest: report.engine.digest,
      runnerVersion: CLI_VERSION,
      volatilePaths: calls.volatile,
    });
    const path = saveBaseline(options.cwd, options.workflowId, baseline);
    written.push(path);
    options.log(`case ${c.caseId}: baseline with ${baseline.calls.length} call${baseline.calls.length === 1 ? '' : 's'} from run ${run}`);
  }
  return written;
}
