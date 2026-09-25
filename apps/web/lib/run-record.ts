/**
 * The content of the PDF record of a run: every call the new version would send, per case, with its fields as the
 * redacted report has them (shapes, never values). Pure data, so it is tested without rendering a PDF.
 */
import { FLAG_TEXT, flattenCall, type CaseDiff, type PlanEntry, type PlanReport } from '@flowretest/core';

export interface RecordField {
  path: string;
  /** What the new version sends; "(absent)" when a field it used to send is gone. */
  sent: string;
  /** What the old version sent, for changed fields only. */
  before?: string;
  changed: boolean;
}

export interface RecordCall {
  op: string;
  node: string;
  request: string;
  note?: string;
  flags: string[];
  fields: RecordField[];
  /** Fields left out after the per-call limit. */
  more: number;
}

export interface RecordCase {
  caseId: string;
  status: string;
  counts: string;
  error?: string;
  notes: string[];
  calls: RecordCall[];
}

export const OP_LABEL: Record<string, string> = {
  '+': 'new call',
  '~': 'changed',
  '-': 'no longer sent',
  '!': 'blocked by the sandbox',
  '=': 'unchanged',
};

/** Shapes (`<string 12 #a1b2c3d4>`), placeholders, numbers and booleans, as the web view prints them. */
export function shown(v: unknown): string {
  if (v === undefined) return '(absent)';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

// Request line fields first (@path, @contentType), then the query, then the body in its own order.
const rank = (path: string) => (path.startsWith('@') ? 0 : path.startsWith('?') ? 1 : 2);

function callOf(entry: PlanEntry, maxFields: number): RecordCall {
  const base = { op: entry.op, node: entry.node, request: `${entry.method} ${entry.host}${entry.pathTemplate}`, flags: entry.flags.map((f) => FLAG_TEXT[f] ?? f) };
  if (entry.op === '-') return { ...base, note: 'The old version sent this call; the new one does not.', fields: [], more: 0 };
  const diffs = new Map(entry.fieldDiffs.map((d) => [d.path, d]));
  const fields: RecordField[] = [];
  const sent = entry.new ? flattenCall(entry.new) : new Map<string, unknown>();
  for (const [path, v] of sent) {
    const d = diffs.get(path);
    fields.push(d ? { path, sent: shown(v), before: shown(d.old), changed: true } : { path, sent: shown(v), changed: false });
  }
  for (const d of entry.fieldDiffs) if (!sent.has(d.path)) fields.push({ path: d.path, sent: shown(d.new), before: shown(d.old), changed: true });
  fields.sort((a, b) => rank(a.path) - rank(b.path));
  return { ...base, note: entry.op === '+' ? 'New in this version.' : undefined, fields: fields.slice(0, maxFields), more: Math.max(0, fields.length - maxFields) };
}

const ORDER: Record<string, number> = { ERROR: 0, BLOCKED: 1, SKIPPED: 1, DIFF: 2, PASS: 3 };

/** Cases needing attention first, as on the run page; every call of each case, unchanged ones included. */
export function recordCases(report: Pick<PlanReport, 'cases'>, maxFields = 150): RecordCase[] {
  return [...report.cases]
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))
    .map((c: CaseDiff) => ({
      caseId: c.caseId,
      status: c.status,
      counts: `${c.summary.oldCalls} call${c.summary.oldCalls === 1 ? '' : 's'} before, ${c.summary.newCalls} after`,
      error: c.error,
      notes: [...(c.expectationFailures ?? []).map((t) => `expectation: ${t}`), ...(c.warnings ?? []).map((t) => `warning: ${t}`), ...(c.engineDifferences ?? []).map((t) => `engine: ${t}`)],
      calls: c.entries.map((e) => callOf(e, maxFields)),
    }));
}

/** flowretest-lead-intake-2026-09-25-diff.pdf: ASCII only, so every browser and mail client keeps the name. */
export function recordFileName(workflowName: string, status: string, date: string): string {
  const slug = workflowName.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
  return `flowretest-${slug}-${date.slice(0, 10)}-${status.toLowerCase()}.pdf`;
}
