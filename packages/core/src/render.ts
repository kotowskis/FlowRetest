import type { CaseDiff, PlanEntry } from './diff.ts';
import type { ScanFinding } from './scan.ts';
import type { CaseStatus } from './types.ts';
import { EXIT_CODES } from './types.ts';

export interface PlanReport {
  runner: string;
  workflowName: string;
  workflowId?: string;
  engine: { image: string; digest?: string };
  oldLabel: string;
  newLabel: string;
  cases: CaseDiff[];
  coverage: { writeNodesTotal: number; writeNodesCaptured: number; replayedNodes: number; unsupported: string[]; stubbed?: string[] };
  sealed: boolean;
  /** Scanner findings for the new version and the structural diff against the old one (plan 5.4, `static`). */
  static?: { findings: ScanFinding[]; diff: ScanFinding[] };
  /** upgrade-check: the same workflow on two engines; the plan gets an "Engine differences" section. */
  upgrade?: { engineOld: string; engineNew: string };
}

/** Lines of the "Engine differences" section, or none outside upgrade-check. */
export function engineSection(report: PlanReport): string[] {
  if (!report.upgrade) return [];
  const lines = [`Engine differences (${report.upgrade.engineOld} -> ${report.upgrade.engineNew}):`];
  const items = report.cases.flatMap((c) => (c.engineDifferences ?? []).map((d) => `  [${c.caseId}] ${d}`));
  const calls = report.cases.reduce((n, c) => n + c.summary.changed + c.summary.added + c.summary.removed, 0);
  if (items.length === 0) lines.push('  node outputs, run counts and errors are the same on both engines');
  else lines.push(...items);
  lines.push(calls === 0 ? '  outbound calls are the same on both engines' : `  outbound calls differ in ${calls} place${calls === 1 ? '' : 's'}, listed in the plan below`);
  return lines;
}

/** "2 errors, 1 warning" over the scanner findings, or undefined when there are none worth a line. */
export function staticSummary(report: Pick<PlanReport, 'static'>): string | undefined {
  if (!report.static) return undefined;
  const all = [...report.static.findings, ...report.static.diff];
  const errors = all.filter((f) => f.severity === 'error').length;
  const warnings = all.filter((f) => f.severity === 'warn').length;
  if (errors + warnings === 0) return undefined;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `Static findings: ${[errors ? part(errors, 'error') : '', warnings ? part(warnings, 'warning') : ''].filter(Boolean).join(', ')} (run \`flowretest scan\` for details)`;
}

const FLAG_TEXT: Record<string, string> = {
  'empty-value': 'empty value in an id field',
  'missing-field': 'field dropped',
  'type-changed': 'field type changed',
  'expression-residue': 'unresolved expression in a value',
  'duplicate-bodies': 'identical bodies sent more than once',
  'count-changed': 'operation count changed',
  'count-per-item-changed': 'calls per input item changed',
  'node-not-executed': 'node did not run in the new version',
  blocked: 'blocked by the sandbox',
};

function fmt(value: unknown): string {
  if (value === undefined) return '(absent)';
  const s = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
  return s.length > 60 ? s.slice(0, 57) + '…"' : s;
}

function entryLines(caseId: string, e: PlanEntry): string[] {
  const head = `${e.op} [${caseId}] ${e.node.padEnd(18)} ${e.method} ${e.host}${e.pathTemplate}`;
  const lines = [head];
  for (const d of e.fieldDiffs.slice(0, 8)) lines.push(`      ${d.path}: ${fmt(d.old)} -> ${fmt(d.new)}`);
  if (e.fieldDiffs.length > 8) lines.push(`      … ${e.fieldDiffs.length - 8} more field changes`);
  if (e.op === '+') lines.push('      (new in this version)');
  if (e.op === '-') lines.push('      (no longer sent)');
  for (const f of e.flags) lines.push(`      ! ${FLAG_TEXT[f] ?? f}`);
  return lines;
}

/** A case is SKIPPED only for an unsupported node on its path, so it counts as BLOCKED: never PASS. */
export function overallStatus(cases: CaseDiff[]): CaseStatus {
  const order: CaseStatus[] = ['ERROR', 'BLOCKED', 'SKIPPED', 'DIFF', 'PASS'];
  for (const s of order) if (cases.some((c) => c.status === s)) return s === 'SKIPPED' ? 'BLOCKED' : s;
  return 'PASS';
}

export function exitCodeFor(status: CaseStatus): number {
  switch (status) {
    case 'PASS':
      return EXIT_CODES.PASS;
    case 'DIFF':
      return EXIT_CODES.DIFF;
    case 'ERROR':
      return EXIT_CODES.ERROR;
    case 'BLOCKED':
    case 'SKIPPED':
      return EXIT_CODES.BLOCKED;
  }
}

/** Plain-text plan, English like the rest of the interface. Colours are added by the CLI. */
export function renderPlan(report: PlanReport): string {
  const lines: string[] = [];
  lines.push(`FlowRetest ${report.runner} · "${report.workflowName}"${report.workflowId ? ` (${report.workflowId})` : ''} · ${report.engine.image}${report.engine.digest ? ` (${report.engine.digest.slice(0, 19)}…)` : ''}`);
  lines.push(`Cases: ${report.cases.length} · old: ${report.oldLabel} · new: ${report.newLabel}`);
  lines.push('');
  const total = report.cases.reduce(
    (acc, c) => ({ oldCalls: acc.oldCalls + c.summary.oldCalls, newCalls: acc.newCalls + c.summary.newCalls, changed: acc.changed + c.summary.changed, added: acc.added + c.summary.added, removed: acc.removed + c.summary.removed, blocked: acc.blocked + c.summary.blocked }),
    { oldCalls: 0, newCalls: 0, changed: 0, added: 0, removed: 0, blocked: 0 },
  );
  const engine = engineSection(report);
  if (engine.length) lines.push(...engine, '');
  lines.push(`Plan: ${total.newCalls} calls (old version: ${total.oldCalls}). ${total.changed} changed, ${total.added} added, ${total.removed} removed, ${total.blocked} blocked.`);
  lines.push('');
  for (const c of report.cases) {
    if (c.status === 'ERROR') lines.push(`E [${c.caseId}] execution failed: ${c.error}`);
    for (const e of c.entries) if (e.op !== '=') lines.push(...entryLines(c.caseId, e));
    for (const f of c.expectationFailures ?? []) lines.push(`x [${c.caseId}] expectation: ${f}`);
    for (const w of c.warnings ?? []) lines.push(`? [${c.caseId}] ${w}`);
  }
  const unchanged = report.cases.reduce((n, c) => n + c.summary.unchanged, 0);
  if (unchanged > 0) lines.push(`= ${unchanged} unchanged call${unchanged === 1 ? '' : 's'}`);
  lines.push('');
  const cov = report.coverage;
  const pct = cov.writeNodesTotal === 0 ? 100 : Math.round((cov.writeNodesCaptured / cov.writeNodesTotal) * 100);
  lines.push(`Coverage: ${cov.writeNodesCaptured} of ${cov.writeNodesTotal} write nodes captured (${pct}%) · nodes replayed from recordings: ${cov.replayedNodes}${cov.unsupported.length ? ` · unsupported: ${cov.unsupported.join(', ')}` : ''}${cov.stubbed?.length ? ` · stubbed: ${cov.stubbed.join(', ')}` : ''} · ${report.sealed ? 'sandbox sealed (checked before the run), 0 requests left it' : 'sandbox seal NOT verified'}`);
  const statics = staticSummary(report);
  if (statics) lines.push(statics);
  const status = overallStatus(report.cases);
  lines.push(`Result: ${status} (exit code ${exitCodeFor(status)})`);
  return lines.join('\n');
}
