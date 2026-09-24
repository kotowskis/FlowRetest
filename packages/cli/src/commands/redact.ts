import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Redactor, redactPlanReport, renderFormat, type Fixture, type PlanReport } from '@flowretest/core';
import { loadConfig, workflowDir } from '../config.ts';
import { loadReport } from './report-files.ts';

export interface RedactOptions {
  cwd: string;
  workflowId: string;
  outDir?: string;
  keepFields?: string[];
  log: (line: string) => void;
}

/** Writes `report.redacted.json` next to a run's report: shapes instead of values, ready to upload or share. */
export function runRedactReport(options: { cwd: string; workflowId: string; run?: string; log: (line: string) => void }): string {
  loadConfig(options.cwd);
  const { run, report } = loadReport(options.cwd, options.workflowId, options.run);
  const plan: PlanReport = { runner: report.runner, workflowName: report.workflowName ?? report.workflowId, workflowId: report.workflowId, engine: report.engine, oldLabel: report.old, newLabel: report.new, cases: report.cases, coverage: report.coverage, sealed: report.sandbox?.sealed === true };
  const redacted = redactPlanReport(plan);
  const runPath = join(workflowDir(options.cwd, options.workflowId), 'runs', run);
  const path = join(runPath, 'report.redacted.json');
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redacted }, null, 2));
  // The Markdown plan of the redacted report is what the GitHub Action posts on a pull request by default.
  writeFileSync(join(runPath, 'plan.redacted.md'), renderFormat(redacted, 'md') + '\n');
  options.log(`redacted report for run ${run}: ${path} and plan.redacted.md (values replaced by type, length and hash; paths, counts and flags kept)`);
  return path;
}

/** Writes redacted copies of every fixture of a workflow; the originals stay where they are. */
export function runRedact(options: RedactOptions): string[] {
  loadConfig(options.cwd);
  const dir = workflowDir(options.cwd, options.workflowId);
  const fixturesDir = join(dir, 'fixtures');
  if (!existsSync(fixturesDir)) throw new Error(`no fixtures in ${fixturesDir}; run \`flowretest pull\` first`);
  const outDir = options.outDir ?? join(dir, 'fixtures-redacted');
  mkdirSync(outDir, { recursive: true });
  const redactor = new Redactor({ keepFields: options.keepFields });
  const written: string[] = [];
  for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Fixture;
    const out = redactor.redactFixture(fixture);
    const path = join(outDir, file);
    writeFileSync(path, JSON.stringify(out));
    written.push(path);
  }
  options.log(`${written.length} redacted fixture${written.length === 1 ? '' : 's'} in ${outDir}; names, emails and phones replaced, identifiers and dates kept`);
  return written;
}
