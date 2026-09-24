import type { Fixture, RecordedItem, RecordedRun } from './fixture.ts';
import type { N8nCredentialRef, N8nNode, N8nWorkflow } from './n8n.ts';
import { removeNode, retargetIncoming, workflowId } from './n8n.ts';
import type { NodeRole } from './types.ts';

export type ReplayVariant = 'code' | 'set';

export interface RewriteOptions {
  version: string;
  caseId: string;
  replayVariant: ReplayVariant;
  /** Recorded data injected into one node above this size marks the node unsupported (default 1 MB). */
  maxInjectBytes?: number;
  executionTimeoutSeconds?: number;
}

export interface ReplacedNode {
  node: string;
  kind: 'trigger' | 'read' | 'respond';
  variant: ReplayVariant | 'noop';
  runs: number;
}

export interface CredentialUse {
  type: string;
  id?: string;
  name?: string;
  node: string;
}

export interface RewriteResult {
  workflow: N8nWorkflow;
  id: string;
  name: string;
  replaced: ReplacedNode[];
  removedTriggers: string[];
  warnings: string[];
  /** Nodes left untouched although they are reads, because they have no recording or it is too large. */
  unreplayed: string[];
  credentials: CredentialUse[];
}

export const START_NODE = 'frt:start';

function replayNodeName(original: string): string {
  return `frt:replay:${original}`;
}

/** n8n ends an expression at the first `}}`, so JSON embedded in one must never contain that token. */
function expressionSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/\}\}/g, '} }').replace(/\{\{/g, '{ {');
}

function normalisePaired(item: RecordedItem): RecordedItem {
  const out: RecordedItem = { json: item.json };
  if (item.pairedItem !== undefined) out.pairedItem = item.pairedItem;
  return out;
}

function buildCodeReplay(name: string, position: [number, number], runs: RecordedItem[][], withPairing: boolean): N8nNode {
  const data = runs.map((items) => items.map(normalisePaired));
  const jsCode = [
    `// FlowRetest replay of "${name}" (${runs.length} recorded run${runs.length === 1 ? '' : 's'})`,
    `const RUNS = ${JSON.stringify(data)};`,
    'const run = RUNS[Math.min($runIndex, RUNS.length - 1)];',
    'const inputCount = $input.all().length;',
    'const clamp = (i) => Math.max(0, Math.min(i, Math.max(inputCount - 1, 0)));',
    'return run.map((item) => {',
    '  const out = { json: item.json };',
    withPairing
      ? [
          '  if (item.pairedItem !== undefined) {',
          '    const p = typeof item.pairedItem === "number" ? { item: item.pairedItem } : item.pairedItem;',
          '    out.pairedItem = Array.isArray(p) ? p.map((x) => ({ item: clamp(x.item) })) : { item: clamp(p.item) };',
          '  }',
        ].join('\n')
      : '  // trigger replay: no upstream items to pair with',
    '  return out;',
    '});',
  ].join('\n');
  return {
    parameters: { jsCode, mode: 'runOnceForAllItems', language: 'javaScript' },
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function buildSetReplay(name: string, position: [number, number], runs: RecordedItem[][]): [N8nNode, N8nNode] {
  const payloads = runs.map((items) => ({ items: items.map((i) => i.json) }));
  const jsonOutput =
    payloads.length === 1
      ? JSON.stringify(payloads[0])
      : `={{ JSON.stringify(${expressionSafeJson(payloads)}[Math.min($runIndex, ${payloads.length - 1})]) }}`;
  const setNode: N8nNode = {
    parameters: { mode: 'raw', jsonOutput, includeOtherFields: false, options: {} },
    name: replayNodeName(name),
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [position[0] - 220, position[1]],
    executeOnce: true,
  };
  const splitNode: N8nNode = {
    parameters: { fieldToSplitOut: 'items', include: 'noOtherFields', options: {} },
    name,
    type: 'n8n-nodes-base.splitOut',
    typeVersion: 1,
    position,
  };
  return [setNode, splitNode];
}

function recordedRuns(fixture: Fixture, name: string): RecordedRun[] | undefined {
  return fixture.nodes[name]?.runs;
}

/**
 * Turns a workflow plus one fixture into an importable sandbox workflow:
 * trigger and read nodes replaced by their recordings, Respond to Webhook
 * replaced by No Operation, everything else untouched.
 */
export function rewriteWorkflow(source: N8nWorkflow, fixture: Fixture, roles: Record<string, NodeRole>, options: RewriteOptions): RewriteResult {
  const workflow = structuredClone(source);
  const warnings: string[] = [];
  const replaced: ReplacedNode[] = [];
  const unreplayed: string[] = [];
  const removedTriggers: string[] = [];
  const maxBytes = options.maxInjectBytes ?? 1024 * 1024;
  const name = `frt/${options.version}/${options.caseId}`;
  const id = workflowId(name);

  const triggerName = fixture.trigger.node;
  if (!workflow.nodes.some((n) => n.name === triggerName)) {
    throw new Error(`trigger "${triggerName}" from the fixture does not exist in the workflow`);
  }

  // 1. Drop every trigger that did not start the recording.
  for (const node of [...workflow.nodes]) {
    if (roles[node.name] === 'trigger' && node.name !== triggerName) {
      removeNode(workflow, node.name);
      removedTriggers.push(node.name);
    }
  }

  // 2. Replace the trigger with Manual Trigger -> replay node carrying the trigger's name.
  const trigger = workflow.nodes.find((n) => n.name === triggerName) as N8nNode;
  const triggerPosition = trigger.position;
  const triggerRuns = [fixture.trigger.items];
  replaceWithReplay(workflow, trigger, triggerRuns, options.replayVariant, false);
  const startNode: N8nNode = {
    parameters: {},
    name: START_NODE,
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [triggerPosition[0] - (options.replayVariant === 'set' ? 460 : 240), triggerPosition[1]],
  };
  workflow.nodes.unshift(startNode);
  const firstReplayNode = options.replayVariant === 'set' ? replayNodeName(triggerName) : triggerName;
  workflow.connections[START_NODE] = { main: [[{ node: firstReplayNode, type: 'main', index: 0 }]] };
  replaced.push({ node: triggerName, kind: 'trigger', variant: options.replayVariant, runs: 1 });

  // 3. Replace read nodes that have a recording; leave the rest for the proxy to block.
  for (const node of [...workflow.nodes]) {
    if (roles[node.name] !== 'read') continue;
    const runs = recordedRuns(fixture, node.name);
    if (!runs || runs.length === 0) {
      unreplayed.push(node.name);
      warnings.push(`"${node.name}" is a read node without a recording; the proxy will block it (add --stub)`);
      continue;
    }
    if (runs.some((r) => r.outputs.length > 1 && r.outputs.slice(1).some((o) => o.length > 0))) {
      unreplayed.push(node.name);
      warnings.push(`"${node.name}" produced data on more than one output in the recording; replay supports one output`);
      continue;
    }
    const outputs = runs.map((r) => r.outputs[0] ?? []);
    const bytes = Buffer.byteLength(JSON.stringify(outputs));
    if (bytes > maxBytes) {
      unreplayed.push(node.name);
      warnings.push(`"${node.name}" recording is ${bytes} bytes, above the ${maxBytes} byte limit; add --stub`);
      continue;
    }
    replaceWithReplay(workflow, node, outputs, options.replayVariant, true);
    replaced.push({ node: node.name, kind: 'read', variant: options.replayVariant, runs: outputs.length });
  }

  // 4. Respond to Webhook has no HTTP response to write to in cli mode; a No Operation keeps the data flowing.
  for (const node of workflow.nodes) {
    if (roles[node.name] !== 'replace') continue;
    node.type = 'n8n-nodes-base.noOp';
    node.typeVersion = 1;
    node.parameters = {};
    delete node.credentials;
    replaced.push({ node: node.name, kind: 'respond', variant: 'noop', runs: 0 });
  }

  // 5. Workflow-level fields: only what `n8n import:workflow` needs. The public API adds project, folder,
  //    version and timestamp fields whose foreign keys do not exist in the sandbox database.
  const settings = { ...(workflow.settings ?? {}) } as Record<string, unknown>;
  delete settings.errorWorkflow;
  settings.executionTimeout = options.executionTimeoutSeconds ?? 120;
  const importable: N8nWorkflow = {
    id,
    name,
    active: false,
    nodes: workflow.nodes.map((node) => stripNode(node)),
    connections: workflow.connections,
    settings,
  };

  return { workflow: importable, id, name, replaced, removedTriggers, warnings, unreplayed, credentials: collectCredentials(importable) };
}

function replaceWithReplay(workflow: N8nWorkflow, node: N8nNode, runs: RecordedItem[][], variant: ReplayVariant, withPairing: boolean): void {
  const index = workflow.nodes.findIndex((n) => n.name === node.name);
  if (variant === 'code') {
    workflow.nodes[index] = buildCodeReplay(node.name, node.position, runs, withPairing);
    return;
  }
  const [setNode, splitNode] = buildSetReplay(node.name, node.position, runs);
  workflow.nodes.splice(index, 1, setNode, splitNode);
  retargetIncoming(workflow, node.name, setNode.name);
  workflow.connections[setNode.name] = { main: [[{ node: node.name, type: 'main', index: 0 }]] };
}

const NODE_FIELDS = ['id', 'name', 'type', 'typeVersion', 'position', 'parameters', 'credentials', 'disabled', 'executeOnce', 'alwaysOutputData', 'onError', 'continueOnFail', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'notes', 'notesInFlow', 'webhookId'] as const;

/** Keeps the node fields the importer understands; drops UI and API decorations. */
function stripNode(node: N8nNode): N8nNode {
  const out: Record<string, unknown> = {};
  for (const key of NODE_FIELDS) if (node[key] !== undefined) out[key] = node[key];
  return out as unknown as N8nNode;
}

export function collectCredentials(workflow: N8nWorkflow): CredentialUse[] {
  const out: CredentialUse[] = [];
  for (const node of workflow.nodes) {
    for (const [type, ref] of Object.entries(node.credentials ?? {})) {
      const r = ref as N8nCredentialRef;
      out.push({ type, id: r.id, name: r.name, node: node.name });
    }
  }
  return out;
}
