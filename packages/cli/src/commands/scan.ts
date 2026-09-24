import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, isTriggerType, renderScan, scanDiff, scanWorkflow, EXIT_CODES, type Fixture, type N8nWorkflow, type ScanFinding, type ScanResult } from '@flowretest/core';
import { serviceRole } from '@flowretest/services';
import { loadConfig, workflowDir } from '../config.ts';

export interface ScanOptions {
  cwd: string;
  workflowId?: string;
  newFile?: string;
  oldFile?: string;
  json?: boolean;
  log: (line: string) => void;
}

export interface ScanOutput {
  trigger: string;
  result: ScanResult;
  diff: ScanFinding[];
  exitCode: number;
}

function guessTrigger(workflow: N8nWorkflow): string {
  const incoming = new Set<string>();
  for (const outputs of Object.values(workflow.connections)) for (const byIndex of Object.values(outputs)) for (const targets of byIndex) for (const t of targets ?? []) incoming.add(t.node);
  const candidate = workflow.nodes.find((n) => !incoming.has(n.name) && isTriggerType(n.type) && n.type !== 'n8n-nodes-base.executeWorkflowTrigger') ?? workflow.nodes.find((n) => !incoming.has(n.name));
  if (!candidate) throw new Error('could not find a trigger node');
  return candidate.name;
}

export function runScan(options: ScanOptions): ScanOutput {
  let oldWorkflow: N8nWorkflow | undefined;
  let newWorkflow: N8nWorkflow | undefined;
  let trigger: string | undefined;
  if (options.workflowId) {
    loadConfig(options.cwd);
    const dir = workflowDir(options.cwd, options.workflowId);
    const published = join(dir, 'workflow.published.json');
    if (existsSync(published)) oldWorkflow = JSON.parse(readFileSync(published, 'utf8')) as N8nWorkflow;
    const fixturesDir = join(dir, 'fixtures');
    if (existsSync(fixturesDir)) {
      const first = readdirSync(fixturesDir).find((f) => f.endsWith('.json'));
      if (first) trigger = (JSON.parse(readFileSync(join(fixturesDir, first), 'utf8')) as Fixture).trigger.node;
    }
  }
  if (options.oldFile) oldWorkflow = JSON.parse(readFileSync(options.oldFile, 'utf8')) as N8nWorkflow;
  if (options.newFile) newWorkflow = JSON.parse(readFileSync(options.newFile, 'utf8')) as N8nWorkflow;
  if (!newWorkflow) newWorkflow = oldWorkflow;
  if (!newWorkflow) throw new Error('nothing to scan: pass --new <file> or --workflow <id> after pull');
  trigger = trigger ?? guessTrigger(newWorkflow);
  const classification = classify(newWorkflow, { triggerNode: trigger, serviceRole });
  const result = scanWorkflow(newWorkflow, classification);
  const diff = oldWorkflow && oldWorkflow !== newWorkflow ? scanDiff(oldWorkflow, newWorkflow) : [];
  const exitCode = classification.unsupportedOnPath.length > 0 ? EXIT_CODES.BLOCKED : EXIT_CODES.PASS;
  if (options.json) options.log(JSON.stringify({ trigger, support: result.support, findings: result.findings, diff, exitCode }, null, 2));
  else {
    options.log(`Trigger: ${trigger}`);
    options.log(renderScan(result, diff));
  }
  return { trigger, result, diff, exitCode };
}
