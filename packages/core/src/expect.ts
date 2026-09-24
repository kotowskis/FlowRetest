import { flattenCall } from './diff.ts';
import type { NormalizedCall } from './normalize.ts';

/** One field condition; the string forms are shorthands for the three checks without an argument. */
export type FieldCheck =
  | 'notEmpty'
  | 'absent'
  | 'present'
  | { notEmpty: true }
  | { absent: true }
  | { present: true }
  | { equals: string | number | boolean | null }
  | { matches: string }
  | { oneOf: Array<string | number | boolean | null> };

/**
 * A hand-written expectation on the new version's calls (ADR 0005: optional, for what the old-versus-new diff cannot
 * show, such as a bug present in both versions). `calls` counts the node's non-blocked calls in one case; `fields`
 * checks every call of the node, with paths as in the plan (`properties.email`, `items[*].id`, `?dry_run`, `@path`).
 */
export interface Expectation {
  node: string;
  /** Only these case ids; all cases when absent. */
  cases?: string[];
  calls?: number | { min?: number; max?: number };
  fields?: Record<string, FieldCheck>;
}

export interface ExpectationsFile {
  schemaVersion: 1;
  expect: Expectation[];
}

const EMPTY = new Set(['', 'undefined', 'null', 'NaN', '[]', '{}']);

function pathPattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\[\\\*\\\]/g, '\\[\\d+\\]');
  return new RegExp(`^${escaped}$`);
}

function valuesAt(call: NormalizedCall, path: string): unknown[] {
  const flat = flattenCall(call);
  if (!path.includes('[*]')) return flat.has(path) ? [flat.get(path)] : [];
  const re = pathPattern(path);
  return [...flat.entries()].filter(([k]) => re.test(k)).map(([, v]) => v);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && EMPTY.has(value.trim()));
}

function same(a: unknown, b: unknown): boolean {
  return a === b || (a !== null && b !== null && a !== undefined && b !== undefined && String(a) === String(b));
}

/** Why one field check fails for the values found at its path, or undefined when it holds. */
function checkField(check: FieldCheck, values: unknown[]): string | undefined {
  const kind = typeof check === 'string' ? check : (Object.keys(check)[0] as string);
  const show = (v: unknown) => JSON.stringify(v);
  switch (kind) {
    case 'absent':
      return values.length ? `is present (${values.map(show).join(', ')})` : undefined;
    case 'present':
      return values.length ? undefined : 'is missing';
    case 'notEmpty':
      if (!values.length) return 'is missing';
      return values.some(isEmpty) ? `is empty (${values.map(show).join(', ')})` : undefined;
    case 'equals': {
      const want = (check as { equals: unknown }).equals;
      if (!values.length) return `is missing, expected ${show(want)}`;
      const bad = values.filter((v) => !same(v, want));
      return bad.length ? `is ${bad.map(show).join(', ')}, expected ${show(want)}` : undefined;
    }
    case 'matches': {
      const re = new RegExp((check as { matches: string }).matches);
      if (!values.length) return `is missing, expected to match /${re.source}/`;
      const bad = values.filter((v) => !re.test(String(v)));
      return bad.length ? `is ${bad.map(show).join(', ')}, expected to match /${re.source}/` : undefined;
    }
    case 'oneOf': {
      const allowed = (check as { oneOf: unknown[] }).oneOf;
      if (!values.length) return `is missing, expected one of ${allowed.map(show).join(', ')}`;
      const bad = values.filter((v) => !allowed.some((a) => same(v, a)));
      return bad.length ? `is ${bad.map(show).join(', ')}, expected one of ${allowed.map(show).join(', ')}` : undefined;
    }
    default:
      return `unknown check ${kind}`;
  }
}

/** Failed expectations for one case, as plan lines; empty when every expectation holds. */
export function checkExpectations(expectations: Expectation[], caseId: string, newCalls: NormalizedCall[]): string[] {
  const failures: string[] = [];
  for (const e of expectations) {
    if (e.cases && !e.cases.includes(caseId)) continue;
    const calls = newCalls.filter((c) => c.node === e.node && !c.blocked).sort((a, b) => a.ts - b.ts);
    if (e.calls !== undefined) {
      const { min, max } = typeof e.calls === 'number' ? { min: e.calls, max: e.calls } : e.calls;
      if ((min !== undefined && calls.length < min) || (max !== undefined && calls.length > max)) {
        const want = min === max ? `${min}` : [min !== undefined ? `at least ${min}` : '', max !== undefined ? `at most ${max}` : ''].filter(Boolean).join(' and ');
        failures.push(`"${e.node}" sent ${calls.length} call${calls.length === 1 ? '' : 's'}, expected ${want}`);
      }
    }
    for (const [path, check] of Object.entries(e.fields ?? {})) {
      calls.forEach((call, i) => {
        const why = checkField(check, valuesAt(call, path));
        if (why) failures.push(`"${e.node}" call ${i + 1}: ${path} ${why}`);
      });
    }
  }
  return failures;
}
