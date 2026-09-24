import { flatten, type NormalizedCall } from './normalize.ts';
import type { CallOp, CaseStatus } from './types.ts';

export interface FieldDiff {
  path: string;
  old: unknown;
  new: unknown;
}

export interface PlanEntry {
  op: CallOp;
  node: string;
  method: string;
  host: string;
  pathTemplate: string;
  old?: NormalizedCall;
  new?: NormalizedCall;
  fieldDiffs: FieldDiff[];
  flags: string[];
}

export interface CaseDiff {
  caseId: string;
  status: CaseStatus;
  entries: PlanEntry[];
  summary: { oldCalls: number; newCalls: number; unchanged: number; changed: number; added: number; removed: number; blocked: number };
  /** Execution error of the new version, when the workflow itself failed. */
  error?: string;
  /** Case-level warnings, e.g. an AI node replayed although its prompt changed. */
  warnings?: string[];
}

export interface DiffOptions {
  /** Execution error message of the new version, if any (turns the case into ERROR). */
  newError?: string;
  oldError?: string;
  /** Similarity threshold (0..1) below which two calls with the same key are not paired as changed. */
  pairThreshold?: number;
  /** Items that entered each node (from runData) in each version; enables count-per-item-changed. */
  oldInputCounts?: Record<string, number>;
  newInputCounts?: Record<string, number>;
  /** Nodes that ran in each version; a write node that ran before but not now gets node-not-executed. */
  oldNodesRun?: string[];
  newNodesRun?: string[];
}

const EMPTY_VALUES = new Set(['', 'undefined', 'null', 'NaN', '[object Object]']);
const ID_FIELD = /(^|[._\-\]])(id|_id|Id|ID|email|Email|uuid|key)$/;

/** Body fields plus query parameters (as `?name`), so a dropped or changed parameter shows up as a field diff. */
export function flattenCall(call: NormalizedCall): Map<string, unknown> {
  const out = flatten(call.body);
  for (const [k, v] of Object.entries(call.query)) out.set(`?${k}`, v);
  return out;
}

function similarity(a: Map<string, unknown>, b: Map<string, unknown>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  if (keys.size === 0) return 1;
  let same = 0;
  for (const k of keys) if (a.has(k) && b.has(k) && Object.is(a.get(k), b.get(k))) same++;
  return same / keys.size;
}

function fieldDiffs(a: Map<string, unknown>, b: Map<string, unknown>): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const av = a.get(k);
    const bv = b.get(k);
    if (!a.has(k) || !b.has(k) || !Object.is(av, bv)) out.push({ path: k, old: a.has(k) ? av : undefined, new: b.has(k) ? bv : undefined });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && EMPTY_VALUES.has(value.trim()));
}

/** Flags on a single call of the new version, independent of the old one. */
export function callFlags(call: NormalizedCall): string[] {
  const flags = new Set<string>();
  const flat = flattenCall(call);
  for (const [path, value] of flat) {
    if (ID_FIELD.test(path) && isEmpty(value)) flags.add('empty-value');
    if (typeof value === 'string' && (/\{\{|\}\}/.test(value) || /^=\s*\{\{/.test(value) || value.includes('[object Object]') || /\bundefined\b/.test(value))) flags.add('expression-residue');
  }
  return [...flags];
}

function entryFlags(oldCall: NormalizedCall | undefined, newCall: NormalizedCall | undefined, diffs: FieldDiff[]): string[] {
  const flags = new Set<string>(newCall ? callFlags(newCall) : []);
  for (const d of diffs) {
    if (d.old !== undefined && d.new === undefined) flags.add('missing-field');
    if (d.old !== undefined && d.new !== undefined && !isEmpty(d.old) && isEmpty(d.new)) flags.add('empty-value');
    if (d.old !== undefined && d.new !== undefined && !isEmpty(d.old) && !isEmpty(d.new) && typeof d.old !== typeof d.new) flags.add('type-changed');
  }
  return [...flags];
}

function groupByKey(calls: NormalizedCall[]): Map<string, NormalizedCall[]> {
  const map = new Map<string, NormalizedCall[]>();
  for (const c of calls) {
    const list = map.get(c.key) ?? [];
    list.push(c);
    map.set(c.key, list);
  }
  return map;
}

/** Diffs the outbound calls of one case: old version against new version (or baseline against new). */
export function diffCase(caseId: string, oldCalls: NormalizedCall[], newCalls: NormalizedCall[], options: DiffOptions = {}): CaseDiff {
  const entries: PlanEntry[] = [];
  const threshold = options.pairThreshold ?? 0.3;
  const oldGroups = groupByKey(oldCalls.filter((c) => !c.blocked));
  const newGroups = groupByKey(newCalls.filter((c) => !c.blocked));
  const keys = [...new Set([...oldGroups.keys(), ...newGroups.keys()])];

  for (const key of keys) {
    const olds = [...(oldGroups.get(key) ?? [])];
    const news = [...(newGroups.get(key) ?? [])];
    const sample = (olds[0] ?? news[0]) as NormalizedCall;
    const base = { node: sample.node, method: sample.method, host: sample.host, pathTemplate: sample.pathTemplate };

    // 1. exact pairs by body hash
    for (let i = olds.length - 1; i >= 0; i--) {
      const j = news.findIndex((n) => n.bodyHash === (olds[i] as NormalizedCall).bodyHash);
      if (j !== -1) {
        entries.push({ op: '=', ...base, old: olds[i], new: news[j], fieldDiffs: [], flags: callFlags(news[j] as NormalizedCall) });
        olds.splice(i, 1);
        news.splice(j, 1);
      }
    }
    // 2. greedy pairing by similarity
    while (olds.length && news.length) {
      let bestI = -1;
      let bestJ = -1;
      let bestScore = -1;
      for (let i = 0; i < olds.length; i++) {
        const fa = flattenCall(olds[i] as NormalizedCall);
        for (let j = 0; j < news.length; j++) {
          const score = similarity(fa, flattenCall(news[j] as NormalizedCall));
          if (score > bestScore) {
            bestScore = score;
            bestI = i;
            bestJ = j;
          }
        }
      }
      if (bestScore < threshold) break;
      const o = olds.splice(bestI, 1)[0] as NormalizedCall;
      const n = news.splice(bestJ, 1)[0] as NormalizedCall;
      const diffs = fieldDiffs(flattenCall(o), flattenCall(n));
      entries.push({ op: '~', ...base, old: o, new: n, fieldDiffs: diffs, flags: entryFlags(o, n, diffs) });
    }
    // 3. leftovers on both sides with the same key: pair in time order so the reader sees field changes, not a removal plus an addition
    olds.sort((a, b) => a.ts - b.ts);
    news.sort((a, b) => a.ts - b.ts);
    while (olds.length && news.length) {
      const o = olds.shift() as NormalizedCall;
      const n = news.shift() as NormalizedCall;
      const diffs = fieldDiffs(flattenCall(o), flattenCall(n));
      entries.push({ op: '~', ...base, old: o, new: n, fieldDiffs: diffs, flags: entryFlags(o, n, diffs) });
    }
    for (const o of olds) entries.push({ op: '-', ...base, old: o, fieldDiffs: [], flags: [] });
    for (const n of news) entries.push({ op: '+', ...base, new: n, fieldDiffs: [], flags: callFlags(n) });
  }

  for (const b of newCalls.filter((c) => c.blocked)) {
    entries.push({ op: '!', node: b.node, method: b.method, host: b.host, pathTemplate: b.pathTemplate, new: b, fieldDiffs: [], flags: ['blocked'] });
  }

  // identical bodies sent more than once by one node in the new version (across loop iterations too) that the old version did not send that often
  const seen = new Map<string, number>();
  for (const n of newCalls.filter((c) => !c.blocked)) seen.set(`${n.node}#${n.bodyHash}`, (seen.get(`${n.node}#${n.bodyHash}`) ?? 0) + 1);
  const oldSeen = new Map<string, number>();
  for (const o of oldCalls.filter((c) => !c.blocked)) oldSeen.set(`${o.node}#${o.bodyHash}`, (oldSeen.get(`${o.node}#${o.bodyHash}`) ?? 0) + 1);
  for (const e of entries) {
    if (!e.new) continue;
    const k = `${e.new.node}#${e.new.bodyHash}`;
    if ((seen.get(k) ?? 0) >= 2 && (oldSeen.get(k) ?? 0) < (seen.get(k) ?? 0)) e.flags = [...new Set([...e.flags, 'duplicate-bodies'])];
  }

  // operation count per node changed
  const countBy = (calls: NormalizedCall[]) => {
    const m = new Map<string, number>();
    for (const c of calls) if (!c.blocked) m.set(c.node, (m.get(c.node) ?? 0) + 1);
    return m;
  };
  const oldCount = countBy(oldCalls);
  const newCount = countBy(newCalls);
  for (const e of entries) {
    if (e.op === '=' || e.op === '!') continue;
    if (oldCount.has(e.node) && newCount.has(e.node) && oldCount.get(e.node) !== newCount.get(e.node)) e.flags = [...new Set([...e.flags, 'count-changed'])];
    const oldIn = options.oldInputCounts?.[e.node];
    const newIn = options.newInputCounts?.[e.node];
    if (oldIn && newIn && oldCount.has(e.node) && newCount.has(e.node)) {
      const oldRatio = (oldCount.get(e.node) ?? 0) / oldIn;
      const newRatio = (newCount.get(e.node) ?? 0) / newIn;
      if (Math.abs(oldRatio - newRatio) > 1e-9) e.flags = [...new Set([...e.flags, 'count-per-item-changed'])];
    }
    if (e.op === '-' && options.oldNodesRun && options.newNodesRun && options.oldNodesRun.includes(e.node) && !options.newNodesRun.includes(e.node)) {
      e.flags = [...new Set([...e.flags, 'node-not-executed'])];
    }
  }

  const order: Record<CallOp, number> = { '!': 0, '~': 1, '+': 2, '-': 3, '=': 4 };
  entries.sort((a, b) => order[a.op] - order[b.op] || (a.new?.ts ?? a.old?.ts ?? 0) - (b.new?.ts ?? b.old?.ts ?? 0));

  const summary = {
    oldCalls: oldCalls.filter((c) => !c.blocked).length,
    newCalls: newCalls.filter((c) => !c.blocked).length,
    unchanged: entries.filter((e) => e.op === '=').length,
    changed: entries.filter((e) => e.op === '~').length,
    added: entries.filter((e) => e.op === '+').length,
    removed: entries.filter((e) => e.op === '-').length,
    blocked: entries.filter((e) => e.op === '!').length,
  };
  let status: CaseStatus = 'PASS';
  if (summary.changed + summary.added + summary.removed > 0) status = 'DIFF';
  if (summary.blocked > 0) status = 'BLOCKED';
  if (options.newError) status = 'ERROR';
  return { caseId, status, entries, summary, error: options.newError };
}
