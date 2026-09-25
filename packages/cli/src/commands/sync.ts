import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CloudError, cloudRequest, cloudToken, cloudUrl } from '../cloud.ts';
import { runAccept } from './accept.ts';
import { baselineDir, loadReport, runsDir } from './report-files.ts';

/** A run directory name as `run` writes it; anything else from the server (a path, `..`) is refused. */
const RUN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
  /** n8n versionId of the accepted workflow, when the uploaded run carried one. */
  workflowVersionId?: string | null;
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
    if (a.localRun && (!RUN_NAME.test(a.localRun) || a.localRun.includes('..'))) {
      const reason = `run name ${JSON.stringify(a.localRun)} is not a run directory name`;
      options.log(`acceptance by ${who}: ${reason}; left pending`);
      result.pending.push({ id: a.id, reason });
      continue;
    }
    if (!a.localRun || !existsSync(join(runsDir(options.cwd, options.workflowId), a.localRun, 'report.json'))) {
      const reason = a.localRun ? `run ${a.localRun} is not on this machine` : 'the run was uploaded without its local run name';
      options.log(`acceptance by ${who} (cases ${a.caseIds.join(', ')}): ${reason}; left pending`);
      result.pending.push({ id: a.id, reason });
      continue;
    }
    // The run directory name is only a timestamp; the accepted workflow version tells a copied or colliding run apart.
    const local = a.workflowVersionId ? loadReport(options.cwd, options.workflowId, a.localRun).report.versions?.new : undefined;
    if (a.workflowVersionId && local && local !== a.workflowVersionId) {
      const reason = `run ${a.localRun} here tested workflow version ${local}, the acceptance is for ${a.workflowVersionId}`;
      options.log(`acceptance by ${who}: ${reason}; left pending`);
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
    // saveBaseline names each file after its case; compared as whole paths, so case 1 is not found in 11.json.
    const dir = baselineDir(options.cwd, options.workflowId);
    const cases = a.caseIds.filter((id) => written.includes(join(dir, `${id}.json`)));
    const refused = notes.filter((n) => /^case \S+: .*not accepted/.test(n));
    const missing = a.caseIds.filter((id) => !cases.includes(id) && !refused.some((n) => n.startsWith(`case ${id}:`)));
    if (missing.length > 0) refused.push(`not in run ${a.localRun}: ${missing.join(', ')}`);
    if (cases.length === 0) {
      // Nothing written (e.g. the local run was not checked with --stabilize): the acceptance stays pending, so a
      // later run or another machine can still apply it.
      const reason = `no baseline could be written from run ${a.localRun}${refused.length ? `: ${refused.join('; ')}` : ''}`;
      options.log(`acceptance by ${who}: ${reason}; left pending`);
      result.pending.push({ id: a.id, reason });
      continue;
    }
    try {
      await cloudRequest(base, token, `/api/acceptances/${encodeURIComponent(a.id)}/applied`, { method: 'POST', body: JSON.stringify({ appliedCases: cases, note: refused.join('\n').slice(0, 2000) || undefined }) });
    } catch (e) {
      // Another machine marked it applied between our list and our write; the baselines here are the same decision.
      if (!(e instanceof CloudError && e.status === 409)) throw e;
      options.log(`acceptance by ${who}: already marked applied elsewhere; baselines written here too`);
    }
    options.log(`acceptance by ${who}: ${cases.length} of ${a.caseIds.length} baseline${a.caseIds.length === 1 ? '' : 's'} written from run ${a.localRun}`);
    result.applied.push({ id: a.id, cases });
  }
  return result;
}
