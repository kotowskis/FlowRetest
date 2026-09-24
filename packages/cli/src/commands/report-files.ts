import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Baseline, CaseDiff, NormalizedCall } from '@flowretest/core';
import { workflowDir } from '../config.ts';

/** report.json written by `run`; the plan can be re-rendered from it without a sandbox. */
export interface RunReport {
  schemaVersion: 1;
  generatedAt: string;
  runner: string;
  workflowId: string;
  workflowName: string;
  engine: { image: string; digest?: string };
  old: string;
  new: string;
  status: string;
  cases: CaseDiff[];
  mode?: 'change' | 'upgrade';
  calls: Record<string, { old: NormalizedCall[]; new: NormalizedCall[]; volatile: string[]; stable?: boolean }>;
  coverage: { writeNodesTotal: number; writeNodesCaptured: number; replayedNodes: number; unsupported: string[]; stubbed?: string[] };
  /** Seal checks done before the run; absent in reports written before 0.3.0. */
  sandbox?: { sealed: boolean; checks: Array<{ network: string; name: string; ok: boolean; detail: string }> };
}

export function runsDir(cwd: string, workflowId: string): string {
  return join(workflowDir(cwd, workflowId), 'runs');
}

export function latestRun(cwd: string, workflowId: string): string | undefined {
  const dir = runsDir(cwd, workflowId);
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'report.json'))).sort().pop();
}

export function loadReport(cwd: string, workflowId: string, run?: string): { run: string; report: RunReport } {
  const chosen = run ?? latestRun(cwd, workflowId);
  if (!chosen) throw new Error(`no runs for workflow ${workflowId}; run \`flowretest run\` first`);
  const path = join(runsDir(cwd, workflowId), chosen, 'report.json');
  if (!existsSync(path)) throw new Error(`no report at ${path}`);
  const report = JSON.parse(readFileSync(path, 'utf8')) as RunReport;
  if (!report.calls) throw new Error(`run ${chosen} was written by an older runner without call registers; run \`flowretest run\` again`);
  return { run: chosen, report };
}

export function baselineDir(cwd: string, workflowId: string): string {
  return join(workflowDir(cwd, workflowId), 'baseline');
}

export function loadBaseline(cwd: string, workflowId: string, caseId: string): Baseline | undefined {
  const path = join(baselineDir(cwd, workflowId), `${caseId}.json`);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline;
}

export function saveBaseline(cwd: string, workflowId: string, baseline: Baseline): string {
  const dir = baselineDir(cwd, workflowId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${baseline.caseId}.json`);
  writeFileSync(path, JSON.stringify(baseline, null, 2));
  return path;
}
