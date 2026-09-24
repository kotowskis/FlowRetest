import { createHash } from 'node:crypto';
import { diffCase } from './diff.ts';
import { flatten, hashBody, type NormalizedCall } from './normalize.ts';

/** Accepted register of one case: what `flowretest accept` writes to baseline/<case>.json. */
export interface Baseline {
  schemaVersion: 1;
  caseId: string;
  acceptedAt: string;
  acceptedBy?: string;
  message?: string;
  workflowVersionId?: string;
  engineDigest?: string;
  runnerVersion: string;
  volatilePaths: string[];
  calls: BaselineCall[];
}

/** A normalised call without run-specific timing. */
export type BaselineCall = Omit<NormalizedCall, 'ts' | 'runIndex' | 'version' | 'caseId'> & { runIndex: number };

export function toBaseline(caseId: string, calls: NormalizedCall[], meta: { acceptedAt: string; runnerVersion: string; acceptedBy?: string; message?: string; workflowVersionId?: string; engineDigest?: string; volatilePaths?: string[] }): Baseline {
  return {
    schemaVersion: 1,
    caseId,
    acceptedAt: meta.acceptedAt,
    acceptedBy: meta.acceptedBy,
    message: meta.message,
    workflowVersionId: meta.workflowVersionId,
    engineDigest: meta.engineDigest,
    runnerVersion: meta.runnerVersion,
    volatilePaths: meta.volatilePaths ?? [],
    calls: calls.map(({ ts: _ts, version: _v, caseId: _c, ...rest }) => rest),
  };
}

/** Turns baseline calls back into comparable calls for diffCase. */
export function fromBaseline(baseline: Baseline): NormalizedCall[] {
  return baseline.calls.map((c, i) => ({ ...c, ts: i, version: 'baseline', caseId: baseline.caseId }));
}

/**
 * Fields that differ between two runs of the same version on the same fixtures
 * are volatile (random ids, nonces, clocks the placeholders missed). Returned as
 * body paths in flatten() notation, ready for `normalize.ignore`.
 */
export function detectVolatile(runA: NormalizedCall[], runB: NormalizedCall[]): string[] {
  const d = diffCase('stabilize', runA, runB);
  const paths = new Set<string>();
  for (const e of d.entries) if (e.op === '~') for (const f of e.fieldDiffs) paths.add(f.path);
  return [...paths].sort();
}

function setPath(value: unknown, path: string[], replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  const [head, ...rest] = path as [string, ...string[]];
  if (Array.isArray(value)) {
    const idx = Number(head);
    return value.map((v, i) => (i === idx ? setPath(v, rest, replacement) : v));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (!(head in obj)) return value;
    return { ...obj, [head]: setPath(obj[head], rest, replacement) };
  }
  return value;
}

/** flatten() paths use `a.b[2].c`; split into segments. */
function splitPath(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((s) => s !== '');
}

/** Masks volatile paths in call bodies and recomputes the hash so exact pairing works again. */
export function maskVolatile(calls: NormalizedCall[], paths: string[]): NormalizedCall[] {
  if (paths.length === 0) return calls;
  return calls.map((call) => {
    let body = call.body;
    for (const p of paths) body = setPath(body, splitPath(p), '<volatile>');
    return { ...call, body, bodyHash: hashBody({ body, query: call.query }) };
  });
}

/** Two runs are identical when every call pairs exactly. */
export function runsIdentical(runA: NormalizedCall[], runB: NormalizedCall[]): boolean {
  const d = diffCase('stability', runA, runB);
  return d.summary.changed + d.summary.added + d.summary.removed + d.summary.blocked === 0;
}

/** Stable fingerprint of a register, e.g. to show in a report footer. */
export function registerFingerprint(calls: NormalizedCall[]): string {
  const h = createHash('sha256');
  for (const c of [...calls].sort((a, b) => a.key.localeCompare(b.key) || a.bodyHash.localeCompare(b.bodyHash))) h.update(`${c.key}|${c.bodyHash}\n`);
  return h.digest('hex').slice(0, 12);
}

export { flatten };
