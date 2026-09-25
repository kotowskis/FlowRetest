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
  /** Accept even when the run did not prove the new version stable across two runs. */
  force?: boolean;
  /** Who accepted; default the OS user. `sync` passes the email of the person who accepted in the hosted layer. */
  acceptedBy?: string;
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
    if (calls.stable === undefined && !options.force) {
      options.log(`case ${c.caseId}: run ${run} did not check stability (use \`run --stabilize\`), not accepted; pass --force to accept anyway`);
      continue;
    }
    if (calls.stable === false && !options.force) {
      options.log(`case ${c.caseId}: the new version differs between two runs even after masking volatile fields; not accepted (add the changing paths to normalize.ignore or pass --force)`);
      continue;
    }
    const baseline = toBaseline(c.caseId, calls.new, {
      acceptedAt: new Date().toISOString(),
      acceptedBy: options.acceptedBy ?? process.env.USERNAME ?? process.env.USER,
      message: options.message,
      engineDigest: report.engine.digest,
      workflowVersionId: report.versions?.new,
      runnerVersion: CLI_VERSION,
      volatilePaths: calls.volatile,
    });
    const path = saveBaseline(options.cwd, options.workflowId, baseline);
    written.push(path);
    options.log(`case ${c.caseId}: baseline with ${baseline.calls.length} call${baseline.calls.length === 1 ? '' : 's'} from run ${run}`);
  }
  if (written.length > 0) options.log('note: baselines hold the request bodies of this run; commit them only where the customer data in them may live (see Privacy in the README)');
  return written;
}
