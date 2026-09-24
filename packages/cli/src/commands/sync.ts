import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cloudRequest, cloudToken, cloudUrl } from '../cloud.ts';
import { runAccept } from './accept.ts';
import { runsDir } from './report-files.ts';

export interface SyncOptions {
  cwd: string;
  workflowId: string;
  url?: string;
  log: (line: string) => void;
}

/** An acceptance made in the hosted layer and not yet written as baselines anywhere. */
export interface PendingAcceptance {
  id: string;
  localRun: string | null;
  caseIds: string[];
  message: string | null;
  acceptedBy: string;
  createdAt: string;
}

export interface SyncResult {
  applied: Array<{ id: string; cases: string[] }>;
  /** Acceptances this machine cannot apply (the accepted run is not here); they stay pending. */
  pending: Array<{ id: string; reason: string }>;
}

/**
 * Writes baselines for acceptances made in the hosted layer. The hosted layer holds only the decision (who, when,
 * which cases, why); the baseline comes from the full report of the accepted run on this machine, so customer
 * values never travel. An acceptance whose run is not here stays pending for the machine that has it.
 */
export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const base = cloudUrl(options.cwd, options.url);
  const token = cloudToken(options.cwd);
  const { acceptances } = await cloudRequest<{ acceptances: PendingAcceptance[] }>(base, token, `/api/acceptances?workflow=${encodeURIComponent(options.workflowId)}`);
  const result: SyncResult = { applied: [], pending: [] };
  if (acceptances.length === 0) {
    options.log('no pending acceptances in the hosted layer');
    return result;
  }
  for (const a of acceptances) {
    const who = `${a.acceptedBy || 'someone'} on ${a.createdAt.slice(0, 16).replace('T', ' ')} UTC`;
    if (!a.localRun || !existsSync(join(runsDir(options.cwd, options.workflowId), a.localRun, 'report.json'))) {
      const reason = a.localRun ? `run ${a.localRun} is not on this machine` : 'the run was uploaded without its local run name';
      options.log(`acceptance by ${who} (cases ${a.caseIds.join(', ')}): ${reason}; left pending`);
      result.pending.push({ id: a.id, reason });
      continue;
    }
    const notes: string[] = [];
    const written = runAccept({
      cwd: options.cwd,
      workflowId: options.workflowId,
      run: a.localRun,
      cases: a.caseIds,
      message: a.message ?? undefined,
      acceptedBy: a.acceptedBy || undefined,
      log: (line) => {
        notes.push(line);
        options.log(line);
      },
    });
    // saveBaseline names each file after its case.
    const cases = a.caseIds.filter((id) => written.some((p) => p.endsWith(`${id}.json`)));
    const refused = notes.filter((n) => /^case \S+: .*not accepted/.test(n));
    const missing = a.caseIds.filter((id) => !cases.includes(id) && !refused.some((n) => n.startsWith(`case ${id}:`)));
    if (missing.length > 0) refused.push(`not in run ${a.localRun}: ${missing.join(', ')}`);
    await cloudRequest(base, token, `/api/acceptances/${encodeURIComponent(a.id)}/applied`, { method: 'POST', body: JSON.stringify({ appliedCases: cases, note: refused.join('\n').slice(0, 2000) || undefined }) });
    options.log(`acceptance by ${who}: ${cases.length} of ${a.caseIds.length} baseline${a.caseIds.length === 1 ? '' : 's'} written from run ${a.localRun}`);
    result.applied.push({ id: a.id, cases });
  }
  return result;
}
