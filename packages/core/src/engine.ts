import type { RunTimings } from './capture.ts';

type Run = RunTimings[string][number] & { error?: { message?: string } | null; executionStatus?: string };

function keysOf(items: Array<unknown> | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const item of items ?? []) {
    const json = (item as { json?: unknown } | null)?.json;
    if (json !== null && typeof json === 'object' && !Array.isArray(json)) for (const k of Object.keys(json as object)) keys.add(k);
  }
  return keys;
}

function listDiff(label: string, before: Set<string>, after: Set<string>): string | undefined {
  const added = [...after].filter((k) => !before.has(k)).sort();
  const removed = [...before].filter((k) => !after.has(k)).sort();
  if (!added.length && !removed.length) return undefined;
  const cut = (xs: string[]) => (xs.length > 5 ? `${xs.slice(0, 5).join(', ')} and ${xs.length - 5} more` : xs.join(', '));
  return [added.length ? `${label} new keys ${cut(added)}` : '', removed.length ? `${label} missing keys ${cut(removed)}` : ''].filter(Boolean).join('; ');
}

/**
 * What each node did differently on the new engine for the same workflow and fixture (plan 6.12, "Engine
 * differences"): nodes that ran on one engine only, run counts, item counts and output keys per output, and errors.
 * The calls are compared by the diff as usual; this explains changes inside the workflow, including ones that do
 * not reach any call yet.
 */
export function engineDifferences(oldRunData: RunTimings, newRunData: RunTimings): string[] {
  const out: string[] = [];
  const nodes = [...new Set([...Object.keys(oldRunData), ...Object.keys(newRunData)])].sort();
  for (const node of nodes) {
    const before = (oldRunData[node] ?? []) as Run[];
    const after = (newRunData[node] ?? []) as Run[];
    if (before.length && !after.length) {
      out.push(`"${node}" ran on the old engine only`);
      continue;
    }
    if (!before.length && after.length) {
      out.push(`"${node}" ran on the new engine only`);
      continue;
    }
    if (before.length !== after.length) out.push(`"${node}" ran ${before.length} time${before.length === 1 ? '' : 's'} on the old engine, ${after.length} on the new one`);
    const runs = Math.min(before.length, after.length);
    for (let r = 0; r < runs; r++) {
      const at = runs > 1 ? ` (run ${r})` : '';
      const oldErr = before[r]?.error?.message;
      const newErr = after[r]?.error?.message;
      if (newErr && newErr !== oldErr) out.push(`"${node}"${at} fails on the new engine: ${newErr}`);
      else if (oldErr && !newErr) out.push(`"${node}"${at} no longer fails on the new engine (old: ${oldErr})`);
      const oldOuts = before[r]?.data?.main ?? [];
      const newOuts = after[r]?.data?.main ?? [];
      for (let o = 0; o < Math.max(oldOuts.length, newOuts.length); o++) {
        const a = oldOuts[o] ?? [];
        const b = newOuts[o] ?? [];
        const label = `"${node}"${at} output ${o}:`;
        if (a.length !== b.length) out.push(`${label} ${a.length} item${a.length === 1 ? '' : 's'} -> ${b.length}`);
        const keys = listDiff(label, keysOf(a), keysOf(b));
        if (keys) out.push(keys);
      }
    }
  }
  return out;
}
