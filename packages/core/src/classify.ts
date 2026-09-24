import type { N8nNode, N8nWorkflow } from './n8n.ts';
import { reachableNodes } from './n8n.ts';
import type { NodeRole } from './types.ts';

export interface Classification {
  triggerNode: string;
  roles: Record<string, NodeRole>;
  /** Names of nodes marked `unsupported` that lie on a path from the trigger. */
  unsupportedOnPath: string[];
  reachable: Set<string>;
  /** Free-text reasons per node, e.g. why it is unsupported or needs review. */
  notes: Record<string, string>;
}

export interface ClassifyOptions {
  /** Node that started the recorded execution; any other trigger is dropped. */
  triggerNode: string;
  /** Roles from service tables (HubSpot, Slack, ...) consulted before the built-in rules. */
  serviceRole?: (node: N8nNode) => { role: NodeRole; note?: string } | undefined;
}

const TRIGGER_TYPES = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.cron',
  'n8n-nodes-base.interval',
  'n8n-nodes-base.formTrigger',
  'n8n-nodes-base.executeWorkflowTrigger',
  '@n8n/n8n-nodes-langchain.chatTrigger',
  'n8n-nodes-base.errorTrigger',
]);

/** Nodes executed for real: pure data transformations from n8n-nodes-base without network access. */
const LOGIC_TYPES = new Set([
  'n8n-nodes-base.set',
  'n8n-nodes-base.if',
  'n8n-nodes-base.switch',
  'n8n-nodes-base.filter',
  'n8n-nodes-base.merge',
  'n8n-nodes-base.splitOut',
  'n8n-nodes-base.aggregate',
  'n8n-nodes-base.splitInBatches',
  'n8n-nodes-base.limit',
  'n8n-nodes-base.removeDuplicates',
  'n8n-nodes-base.sort',
  'n8n-nodes-base.noOp',
  'n8n-nodes-base.renameKeys',
  'n8n-nodes-base.dateTime',
  'n8n-nodes-base.crypto',
  'n8n-nodes-base.compareDatasets',
  'n8n-nodes-base.summarize',
  'n8n-nodes-base.itemLists',
  'n8n-nodes-base.markdown',
  'n8n-nodes-base.html',
  'n8n-nodes-base.xml',
  'n8n-nodes-base.editImage',
  'n8n-nodes-base.stopAndError',
]);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isTriggerType(type: string): boolean {
  return TRIGGER_TYPES.has(type) || /trigger$/i.test(type);
}

const LANGCHAIN_PREFIX = '@n8n/n8n-nodes-langchain.';

/** Nodes that feed another node through an `ai_*` connection (models, memory, tools, parsers, embeddings). */
export function aiSubNodes(workflow: N8nWorkflow): Set<string> {
  const subs = new Set<string>();
  for (const [from, outputs] of Object.entries(workflow.connections)) {
    for (const type of Object.keys(outputs)) if (type !== 'main') subs.add(from);
  }
  return subs;
}

/**
 * A vector store root in insert or update mode (or a legacy `...Insert` node) writes to the store; replaying it from
 * the recording would hide the write. Load mode reads and stays an AI root. The mode defaults to `retrieve`.
 */
export function isVectorStoreWrite(node: N8nNode): boolean {
  const name = node.type.startsWith(LANGCHAIN_PREFIX) ? node.type.slice(LANGCHAIN_PREFIX.length) : '';
  if (!/vectorStore/i.test(name)) return false;
  if (/Insert$/.test(name)) return true;
  const mode = node.parameters.mode;
  return mode === 'insert' || mode === 'update' || (typeof mode === 'string' && mode.startsWith('='));
}

export function isAiRoot(node: N8nNode, subNodes: Set<string>): boolean {
  return node.type.startsWith(LANGCHAIN_PREFIX) && !subNodes.has(node.name) && !isTriggerType(node.type) && !isVectorStoreWrite(node);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/**
 * Warnings for AI nodes replayed from a recording in the new version: a changed
 * prompt, model or sub-node makes the recorded output stale, and a brand-new AI
 * node has no recording at all.
 */
export function aiReplayWarnings(oldWorkflow: N8nWorkflow, newWorkflow: N8nWorkflow): string[] {
  const warnings: string[] = [];
  const oldSubs = aiSubNodes(oldWorkflow);
  const newSubs = aiSubNodes(newWorkflow);
  const oldNodes = new Map(oldWorkflow.nodes.map((n) => [n.name, n]));
  const feedersOf = (workflow: N8nWorkflow, root: string): string =>
    stable(
      Object.entries(workflow.connections)
        .flatMap(([from, outputs]) => Object.entries(outputs).filter(([type]) => type !== 'main').flatMap(([type, byIndex]) => byIndex.flatMap((targets) => (targets ?? []).filter((t) => t.node === root).map(() => `${type}:${from}:${stable(workflow.nodes.find((n) => n.name === from)?.parameters ?? null)}`))))
        .sort(),
    );
  for (const node of newWorkflow.nodes) {
    if (!isAiRoot(node, newSubs)) continue;
    const before = oldNodes.get(node.name);
    if (!before || !isAiRoot(before, oldSubs)) {
      warnings.push(`AI node "${node.name}" is new in this version and has no recording; its call is executed for real against the sink`);
      continue;
    }
    if (stable(before.parameters) !== stable(node.parameters) || feedersOf(oldWorkflow, node.name) !== feedersOf(newWorkflow, node.name)) {
      warnings.push(`stale-ai-replay: AI node "${node.name}" is replayed from its recording although its prompt, model or sub-nodes changed; the recorded output may not match the new configuration`);
    }
  }
  return warnings;
}

function classifyOne(node: N8nNode, options: ClassifyOptions, subNodes: Set<string>): { role: NodeRole; note?: string } {
  if (node.name === options.triggerNode) return { role: 'trigger' };
  if (isTriggerType(node.type)) return { role: 'trigger', note: 'trigger that did not start the recording, removed' };
  if (subNodes.has(node.name)) return { role: 'logic', note: 'AI sub-node, removed together with its replayed root' };
  if (isVectorStoreWrite(node)) return { role: 'unsupported', note: 'vector store insert or update writes through the vendor SDK and cannot be replayed or captured; case skipped' };
  if (isAiRoot(node, subNodes)) return { role: 'read', note: 'AI node replayed from the recording; a changed prompt or model is not evaluated' };
  const fromService = options.serviceRole?.(node);
  if (fromService) return fromService;
  if (node.type === 'n8n-nodes-base.respondToWebhook') return { role: 'replace', note: 'replaced by No Operation, no outbound call' };
  if (node.type === 'n8n-nodes-base.httpRequest') {
    const options = (node.parameters.options ?? {}) as Record<string, unknown>;
    if (typeof options.proxy === 'string' && options.proxy.trim() !== '') return { role: 'unsupported', note: 'HTTP Request with its own Proxy option would bypass the sandbox' };
    // v1 and v2 keep the verb in requestMethod; both default to GET and are left out of the JSON when GET.
    const method = node.parameters.method ?? node.parameters.requestMethod;
    if (method === undefined) return { role: 'read' };
    if (typeof method === 'string' && method.startsWith('=')) return { role: 'write', note: 'method is an expression, treated as a write, review' };
    if (typeof method === 'string' && READ_METHODS.has(method.toUpperCase())) return { role: 'read' };
    return { role: 'write' };
  }
  if (node.type === 'n8n-nodes-base.code') {
    const language = node.parameters.language ?? 'javaScript';
    if (language !== 'javaScript') return { role: 'unsupported', note: `Code node language ${String(language)} needs the Python runner` };
    return { role: 'logic' };
  }
  if (LOGIC_TYPES.has(node.type)) return { role: 'logic' };
  return { role: 'unsupported', note: `no role table for ${node.type}` };
}

export function classify(workflow: N8nWorkflow, options: ClassifyOptions): Classification {
  const roles: Record<string, NodeRole> = {};
  const notes: Record<string, string> = {};
  const subNodes = aiSubNodes(workflow);
  for (const node of workflow.nodes) {
    // A disabled trigger is still a trigger: n8n's CLI picks the first Execute Workflow Trigger as the start node even
    // when it is disabled, so it must be removed like any trigger that did not start the recording.
    if (node.disabled && node.name !== options.triggerNode && isTriggerType(node.type)) {
      roles[node.name] = 'trigger';
      notes[node.name] = 'disabled trigger, removed';
      continue;
    }
    if (node.disabled) {
      roles[node.name] = 'logic';
      notes[node.name] = 'disabled, passes data through';
      continue;
    }
    const { role, note } = classifyOne(node, options, subNodes);
    roles[node.name] = role;
    if (note) notes[node.name] = note;
  }
  const reachable = reachableNodes(workflow, options.triggerNode);
  const unsupportedOnPath = workflow.nodes.filter((n) => roles[n.name] === 'unsupported' && reachable.has(n.name)).map((n) => n.name);
  return { triggerNode: options.triggerNode, roles, unsupportedOnPath, reachable, notes };
}
