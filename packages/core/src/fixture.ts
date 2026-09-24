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
  source?: Array<{ previousNode?: string } | null>;
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

function inputCountOf(runData: Record<string, RawRunDataEntry[]>, _entries: RawRunDataEntry[], _index: number, entry: RawRunDataEntry): number | undefined {
  const previous = entry.source?.[0]?.previousNode;
  if (!previous) return undefined;
  const prevRuns = runData[previous];
  if (!prevRuns || prevRuns.length === 0) return undefined;
  const last = prevRuns[prevRuns.length - 1];
  return last?.data?.main?.[0]?.length;
}
