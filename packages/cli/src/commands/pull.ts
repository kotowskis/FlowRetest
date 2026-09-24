import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureFromExecution, type Fixture, type N8nWorkflow, type RawExecution } from '@flowretest/core';
import { N8nClient } from '../api/client.ts';
import { loadApiKey, loadConfig, workflowDir } from '../config.ts';

export interface PullOptions {
  cwd: string;
  workflowId: string;
  last?: number;
  since?: string;
  maxSizeBytes?: number;
  includeErrors?: boolean;
  log: (line: string) => void;
}

export interface PullResult {
  workflow: N8nWorkflow;
  fixtures: Fixture[];
  skipped: Array<{ id: string; reason: string }>;
  dir: string;
}

export async function runPull(options: PullOptions): Promise<PullResult> {
  const config = loadConfig(options.cwd);
  const client = new N8nClient(config.instance.url, loadApiKey(options.cwd));
  const version = await client.detectVersion(config.instance.url);
  if (version) options.log(`instance ${config.instance.url} runs n8n ${version}${version !== config.engine.tag ? ` (config says ${config.engine.tag})` : ''}`);
  const workflow = await client.getWorkflow(options.workflowId);
  const dir = workflowDir(options.cwd, options.workflowId);
  mkdirSync(join(dir, 'fixtures'), { recursive: true });
  writeFileSync(join(dir, 'workflow.published.json'), JSON.stringify(workflow, null, 2));
  options.log(`workflow "${workflow.name}" (${workflow.nodes.length} nodes, version ${workflow.versionId ?? '?'}) saved`);

  const wanted = options.last ?? 10;
  const maxSize = options.maxSizeBytes ?? 5 * 1024 * 1024;
  const fixtures: Fixture[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let cursor: string | undefined;
  let seen = 0;
  while (fixtures.length < wanted) {
    const page = await client.listExecutions({ workflowId: options.workflowId, status: options.includeErrors ? undefined : 'success', limit: Math.min(25, wanted), cursor, includeData: true, startedAfter: options.since });
    if (page.data.length === 0) break;
    for (const raw of page.data) {
      seen += 1;
      if (fixtures.length >= wanted) break;
      let execution: RawExecution = raw;
      if ((raw as { dataTooLargeToDisplay?: boolean }).dataTooLargeToDisplay || !raw.data) {
        execution = await client.getExecution(String(raw.id), { includeData: true, ignoreDataSizeLimit: true });
      }
      if (!execution.data?.resultData?.runData) {
        skipped.push({ id: String(raw.id), reason: 'no execution data saved (workflow or instance setting)' });
        continue;
      }
      try {
        const fixture = fixtureFromExecution(execution, execution.workflowData ?? workflow, new URL(config.instance.url).host);
        if ((fixture.sizeBytes ?? 0) > maxSize) {
          skipped.push({ id: String(raw.id), reason: `fixture ${fixture.sizeBytes} bytes above limit ${maxSize}` });
          continue;
        }
        writeFileSync(join(dir, 'fixtures', `${fixture.source.executionId}.json`), JSON.stringify(fixture));
        fixtures.push(fixture);
      } catch (err) {
        skipped.push({ id: String(raw.id), reason: err instanceof Error ? err.message : String(err) });
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const versions = new Set(fixtures.map((f) => f.source.workflowVersionId ?? '?'));
  options.log(`${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'} from ${seen} execution${seen === 1 ? '' : 's'} (${[...versions].length} workflow version${versions.size === 1 ? '' : 's'}: ${[...versions].join(', ')})`);
  if (seen === 0) options.log('no executions found: check that the workflow saves successful executions (workflow settings or EXECUTIONS_DATA_SAVE_ON_SUCCESS) and that retention has not pruned them');
  for (const s of skipped) options.log(`  skipped ${s.id}: ${s.reason}`);
  return { workflow, fixtures, skipped, dir };
}
