import type { N8nWorkflow } from './n8n.ts';

/** One item as n8n stores it in runData. */
export interface RecordedItem {
  json: unknown;
  pairedItem?: number | { item: number; input?: number } | Array<{ item: number; input?: number }>;
  binary?: unknown;
}

/** One run of a node: outputs per output index (IF has two, most nodes one). */
export interface RecordedRun {
  startTime?: number;
  executionTime?: number;
  inputCount?: number;
  outputs: RecordedItem[][];
}

export interface RecordedNode {
  type: string;
  typeVersion: number;
  runs: RecordedRun[];
}

export interface FixtureSource {
  instanceHost?: string;
  workflowId: string;
  executionId: string;
  workflowVersionId?: string;
  startedAt?: string;
  mode?: string;
  status?: string;
}

/** A recorded execution turned into test input; see docs/plan-implementacji, section 5.3. */
export interface Fixture {
  schemaVersion: 1;
  source: FixtureSource;
  workflowData?: N8nWorkflow;
  trigger: { node: string; type: string; typeVersion: number; items: RecordedItem[] };
  nodes: Record<string, RecordedNode>;
  sizeBytes?: number;
  redacted: boolean;
}

interface RawRunDataEntry {
  startTime?: number;
  executionTime?: number;
  executionStatus?: string;
  data?: { main?: Array<RecordedItem[] | null> };
  source?: Array<{ previousNode?: string; previousNodeOutput?: number; previousNodeRun?: number } | null>;
  error?: unknown;
}

export interface RawExecution {
  id: string | number;
  workflowId?: string;
  workflowVersionId?: string | null;
  mode?: string;
  status?: string;
  startedAt?: string;
  workflowData?: N8nWorkflow;
  data?: { resultData?: { runData?: Record<string, RawRunDataEntry[]> } };
}

/**
 * Builds a fixture from an execution object of the public API (`includeData=true`).
 * The trigger is the node that ran first and has no incoming connection.
 */
export function fixtureFromExecution(execution: RawExecution, workflow: N8nWorkflow | undefined, instanceHost?: string): Fixture {
  const runData = execution.data?.resultData?.runData ?? {};
  const wf = workflow ?? execution.workflowData;
  if (!wf) throw new Error(`execution ${execution.id}: no workflow data available`);
  const incoming = new Set<string>();
  for (const outputs of Object.values(wf.connections ?? {})) {
    for (const byIndex of Object.values(outputs)) for (const targets of byIndex) for (const t of targets ?? []) incoming.add(t.node);
  }
  const candidates = Object.keys(runData).filter((name) => !incoming.has(name) && wf.nodes.some((n) => n.name === name));
  candidates.sort((a, b) => (runData[a]?.[0]?.startTime ?? 0) - (runData[b]?.[0]?.startTime ?? 0));
  const triggerName = candidates[0];
  if (!triggerName) throw new Error(`execution ${execution.id}: could not find the trigger node in runData`);
  const triggerNode = wf.nodes.find((n) => n.name === triggerName) as N8nWorkflow['nodes'][number];

  const nodes: Fixture['nodes'] = {};
  for (const [name, entries] of Object.entries(runData)) {
    const node = wf.nodes.find((n) => n.name === name);
    if (!node) continue;
    nodes[name] = {
      type: node.type,
      typeVersion: node.typeVersion,
      runs: entries.map((entry, index) => ({
        startTime: entry.startTime,
        executionTime: entry.executionTime,
        inputCount: inputCountOf(runData, entries, index, entry),
        outputs: (entry.data?.main ?? []).map((items) => items ?? []),
      })),
    };
  }
  const fixture: Fixture = {
    schemaVersion: 1,
    source: {
      instanceHost,
      workflowId: String(execution.workflowId ?? wf.id ?? ''),
      executionId: String(execution.id),
      workflowVersionId: execution.workflowVersionId ?? wf.versionId,
      startedAt: execution.startedAt,
      mode: execution.mode,
      status: execution.status,
    },
    workflowData: execution.workflowData,
    trigger: {
      node: triggerName,
      type: triggerNode.type,
      typeVersion: triggerNode.typeVersion,
      items: nodes[triggerName]?.runs[0]?.outputs[0] ?? [],
    },
    nodes,
    redacted: false,
  };
  fixture.sizeBytes = Buffer.byteLength(JSON.stringify(fixture));
  return fixture;
}

/** Items that entered this run: the output and run of the previous node named in `source`, like capture.inputCounts. */
function inputCountOf(runData: Record<string, RawRunDataEntry[]>, _entries: RawRunDataEntry[], _index: number, entry: RawRunDataEntry): number | undefined {
  const src = entry.source?.[0];
  if (!src?.previousNode) return undefined;
  const prevRuns = runData[src.previousNode];
  if (!prevRuns || prevRuns.length === 0) return undefined;
  const prevRun = prevRuns[src.previousNodeRun ?? prevRuns.length - 1] ?? prevRuns[prevRuns.length - 1];
  return prevRun?.data?.main?.[src.previousNodeOutput ?? 0]?.length ?? 0;
}

/**
 * Plan 6.3 point 4: a read node is replayed with its recorded output even when the new version feeds it a different
 * number of items (a filter moved in front of it, a loop that runs more often). The output is then stale, so the case
 * gets a `replay-input-mismatch` warning with both counts.
 */
export function replayInputWarnings(fixture: Fixture, replayedNodes: string[], newInputCounts: Record<string, number>): string[] {
  const warnings: string[] = [];
  for (const node of replayedNodes) {
    const runs = fixture.nodes[node]?.runs ?? [];
    if (runs.length === 0 || runs.some((r) => r.inputCount === undefined)) continue;
    const recorded = runs.reduce((sum, r) => sum + (r.inputCount ?? 0), 0);
    const now = newInputCounts[node];
    if (now === undefined || now === recorded) continue;
    warnings.push(`replay-input-mismatch: "${node}" was recorded with ${recorded} input item${recorded === 1 ? '' : 's'} but got ${now} in this version; its recorded output was replayed unchanged`);
  }
  return warnings;
}
