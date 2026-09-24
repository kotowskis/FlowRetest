import { createHash } from 'node:crypto';
import { diffCase } from './diff.ts';
import { callHash, flatten, splitFlatPath, type NormalizedCall, type QueryValues } from './normalize.ts';

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

/** Turns baseline calls back into comparable calls for diffCase; the hash is recomputed so older baselines still pair exactly. */
export function fromBaseline(baseline: Baseline): NormalizedCall[] {
  return baseline.calls.map((c, i) => {
    const call = { ...c, ts: i, version: 'baseline', caseId: baseline.caseId };
    return { ...call, bodyHash: callHash(call) };
  });
}

/** Separates the call key from the field path in a volatile entry. */
export const VOLATILE_SEPARATOR = ' :: ';

/**
 * Fields that differ between two runs of the same version on the same fixtures
 * are volatile (random ids, nonces, clocks the placeholders missed). Each entry is
 * scoped to one call key (`<key> :: <field path>`), so a random `id` in a log call
 * never masks `id` in an upsert. Field paths use flattenCall() notation: body
 * fields, `@path`, `@contentType`, `?param`.
 */
export function detectVolatile(runA: NormalizedCall[], runB: NormalizedCall[]): string[] {
  const d = diffCase('stabilize', runA, runB);
  const paths = new Set<string>();
  for (const e of d.entries) if (e.op === '~' && e.old) for (const f of e.fieldDiffs) paths.add(`${e.old.key}${VOLATILE_SEPARATOR}${f.path}`);
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

function maskQuery(query: QueryValues, fieldPath: string): QueryValues {
  const m = /^\?(.+?)(?:\[(\d+)\])?$/.exec(fieldPath);
  if (!m) return query;
  const name = m[1] as string;
  const current = query[name];
  if (current === undefined) return query;
  if (m[2] !== undefined && Array.isArray(current)) return { ...query, [name]: current.map((v, i) => (i === Number(m[2]) ? '<volatile>' : v)) };
  return { ...query, [name]: '<volatile>' };
}

function maskField(call: NormalizedCall, fieldPath: string): NormalizedCall {
  if (fieldPath === '@path') return { ...call, pathValue: '<volatile>' };
  if (fieldPath === '@contentType') return { ...call, contentType: '<volatile>' };
  if (fieldPath.startsWith('?')) return { ...call, query: maskQuery(call.query, fieldPath) };
  return { ...call, body: setPath(call.body, splitFlatPath(fieldPath), '<volatile>') };
}

/**
 * Masks volatile fields and recomputes the hash so exact pairing works again. Entries
 * without a key (baselines written before 0.3.0) apply to the body of every call.
 */
export function maskVolatile(calls: NormalizedCall[], paths: string[]): NormalizedCall[] {
  if (paths.length === 0) return calls;
  const scoped = paths.map((p) => {
    const at = p.lastIndexOf(VOLATILE_SEPARATOR);
    return at === -1 ? { key: undefined, field: p } : { key: p.slice(0, at), field: p.slice(at + VOLATILE_SEPARATOR.length) };
  });
  return calls.map((call) => {
    let masked = call;
    for (const { key, field } of scoped) if (key === undefined || key === call.key) masked = maskField(masked, field);
    return masked === call ? call : { ...masked, bodyHash: callHash(masked) };
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
