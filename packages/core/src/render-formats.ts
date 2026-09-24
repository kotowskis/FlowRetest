import type { CaseDiff, PlanEntry } from './diff.ts';
import type { PlanReport } from './render.ts';
import { exitCodeFor, overallStatus, renderPlan } from './render.ts';

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function entrySummary(e: PlanEntry): string {
  const diffs = e.fieldDiffs.slice(0, 5).map((d) => `${d.path}: ${JSON.stringify(d.old)} -> ${JSON.stringify(d.new)}`).join('; ');
  return `${e.op} ${e.node} ${e.method} ${e.host}${e.pathTemplate}${diffs ? ` (${diffs})` : ''}${e.flags.length ? ` [${e.flags.join(', ')}]` : ''}`;
}

/** One testcase per case; DIFF and ERROR are failures, BLOCKED and SKIPPED are skipped with a message. */
export function renderJUnit(report: PlanReport): string {
  const cases = report.cases;
  const failures = cases.filter((c) => c.status === 'DIFF' || c.status === 'ERROR').length;
  const skipped = cases.filter((c) => c.status === 'BLOCKED' || c.status === 'SKIPPED').length;
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`<testsuites name="flowretest" tests="${cases.length}" failures="${failures}" skipped="${skipped}">`);
  lines.push(`  <testsuite name="${xmlEscape(report.workflowName)}" tests="${cases.length}" failures="${failures}" skipped="${skipped}">`);
  for (const c of cases) {
    const name = xmlEscape(`case ${c.caseId}`);
    const detail = c.entries.filter((e) => e.op !== '=').map(entrySummary).join('\n');
    if (c.status === 'PASS') lines.push(`    <testcase classname="flowretest" name="${name}"/>`);
    else if (c.status === 'DIFF') lines.push(`    <testcase classname="flowretest" name="${name}"><failure message="${xmlEscape(`${c.summary.changed} changed, ${c.summary.added} added, ${c.summary.removed} removed`)}">${xmlEscape(detail)}</failure></testcase>`);
    else if (c.status === 'ERROR') lines.push(`    <testcase classname="flowretest" name="${name}"><failure message="${xmlEscape(c.error ?? 'execution failed')}">${xmlEscape(detail)}</failure></testcase>`);
    else lines.push(`    <testcase classname="flowretest" name="${name}"><skipped message="${xmlEscape(c.status === 'BLOCKED' ? `${c.summary.blocked} blocked call(s)` : (c.error ?? 'skipped'))}"/></testcase>`);
  }
  lines.push('  </testsuite>', '</testsuites>');
  return lines.join('\n') + '\n';
}

const MARKDOWN_LIMIT = 60 * 1024;

function statusEmojiFree(status: string): string {
  return status;
}

function caseSection(c: CaseDiff): string[] {
  const lines: string[] = [];
  const visible = c.entries.filter((e) => e.op !== '=');
  const title = `case ${c.caseId}: ${statusEmojiFree(c.status)} (${c.summary.changed} changed, ${c.summary.added} added, ${c.summary.removed} removed, ${c.summary.blocked} blocked)`;
  if (visible.length === 0 && !c.error && !(c.warnings ?? []).length) {
    lines.push(`- ${title}`);
    return lines;
  }
  lines.push('<details>', `<summary>${title}</summary>`, '');
  if (c.error) lines.push(`Execution: ${c.error}`, '');
  for (const w of c.warnings ?? []) lines.push(`Warning: ${w}`, '');
  lines.push('```');
  for (const e of visible) {
    lines.push(`${e.op} ${e.node}  ${e.method} ${e.host}${e.pathTemplate}`);
    for (const d of e.fieldDiffs.slice(0, 8)) lines.push(`      ${d.path}: ${JSON.stringify(d.old)} -> ${JSON.stringify(d.new)}`);
    if (e.fieldDiffs.length > 8) lines.push(`      … ${e.fieldDiffs.length - 8} more`);
    for (const f of e.flags) lines.push(`      ! ${f}`);
  }
  lines.push('```', '</details>', '');
  return lines;
}

/** Markdown for a pull request comment: summary table first, collapsible detail per case, capped at 60 kB. */
export function renderMarkdown(report: PlanReport): string {
  const status = overallStatus(report.cases);
  const total = report.cases.reduce(
    (acc, c) => ({ oldCalls: acc.oldCalls + c.summary.oldCalls, newCalls: acc.newCalls + c.summary.newCalls, changed: acc.changed + c.summary.changed, added: acc.added + c.summary.added, removed: acc.removed + c.summary.removed, blocked: acc.blocked + c.summary.blocked }),
    { oldCalls: 0, newCalls: 0, changed: 0, added: 0, removed: 0, blocked: 0 },
  );
  const head: string[] = [];
  head.push(`## FlowRetest: ${status} for "${report.workflowName}"`, '');
  head.push(`Plan: ${total.newCalls} calls (old version: ${total.oldCalls}). ${total.changed} changed, ${total.added} added, ${total.removed} removed, ${total.blocked} blocked.`, '');
  head.push('| Case | Status | Changed | Added | Removed | Blocked |', '|---|---|---|---|---|---|');
  for (const c of report.cases) head.push(`| ${c.caseId} | ${c.status} | ${c.summary.changed} | ${c.summary.added} | ${c.summary.removed} | ${c.summary.blocked} |`);
  head.push('');
  const cov = report.coverage;
  const pct = cov.writeNodesTotal === 0 ? 100 : Math.round((cov.writeNodesCaptured / cov.writeNodesTotal) * 100);
  const foot = [`Coverage: ${cov.writeNodesCaptured} of ${cov.writeNodesTotal} write nodes captured (${pct}%), ${cov.replayedNodes} nodes replayed from recordings${cov.unsupported.length ? `, unsupported: ${cov.unsupported.join(', ')}` : ''}. ${report.sealed ? '0 requests left the sandbox.' : 'Sandbox seal not verified.'}`, `Engine ${report.engine.image}${report.engine.digest ? ` (${report.engine.digest.slice(0, 26)}…)` : ''}, old: ${report.oldLabel}, new: ${report.newLabel}, exit code ${exitCodeFor(status)}.`, ''];
  const sections = report.cases.flatMap(caseSection);
  let body = [...head, ...sections, ...foot].join('\n');
  if (body.length > MARKDOWN_LIMIT) {
    const kept: string[] = [];
    let size = head.join('\n').length + foot.join('\n').length + 200;
    let dropped = 0;
    for (const c of report.cases) {
      const s = caseSection(c).join('\n');
      if (size + s.length < MARKDOWN_LIMIT) {
        kept.push(s);
        size += s.length + 1;
      } else dropped += 1;
    }
    body = [...head, ...kept, dropped ? `_${dropped} case section${dropped === 1 ? '' : 's'} omitted to stay under the comment size limit; see plan.txt in the run directory._` : '', '', ...foot].join('\n');
  }
  return body;
}

export type PlanFormat = 'terminal' | 'json' | 'junit' | 'md';

export function renderFormat(report: PlanReport, format: PlanFormat): string {
  switch (format) {
    case 'terminal':
      return renderPlan(report);
    case 'junit':
      return renderJUnit(report);
    case 'md':
      return renderMarkdown(report);
    case 'json':
      return JSON.stringify(report, null, 2);
  }
}
