/** Minimal shape of the n8n workflow JSON that the runner reads and rewrites. */

export interface N8nCredentialRef {
  id?: string;
  name?: string;
}

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, N8nCredentialRef>;
  disabled?: boolean;
  executeOnce?: boolean;
  alwaysOutputData?: boolean;
  onError?: string;
  continueOnFail?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  notes?: string;
  [key: string]: unknown;
}

export interface N8nConnectionTarget {
  node: string;
  type: string;
  index: number;
}

/** connections[fromNode][outputType][outputIndex] = targets (or null for an unused output). */
export type N8nConnections = Record<string, Record<string, Array<N8nConnectionTarget[] | null>>>;

export interface N8nWorkflow {
  id?: string;
  name: string;
  active?: boolean;
  nodes: N8nNode[];
  connections: N8nConnections;
  settings?: Record<string, unknown>;
  pinData?: unknown;
  versionId?: string;
  tags?: unknown;
  meta?: unknown;
  [key: string]: unknown;
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * n8n 2.x refuses to import a workflow without an id (NOT NULL on workflow_entity.id) and keeps the one
 * given; ids are 16 alphanumerics. The last character is always a digit because `executeBatch --ids`
 * keeps only ids that match /\d+/ and silently drops the rest.
 */
export function workflowId(seed: string): string {
  let hash = 2166136261;
  for (const ch of seed) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let out = '';
  let state = hash;
  for (let i = 0; i < 15; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out += ID_ALPHABET[state % ID_ALPHABET.length];
  }
  state = (Math.imul(state, 1103515245) + 12345) >>> 0;
  return out + String(state % 10);
}

/** Node names referenced by expressions such as $('Name'), $("Name"), $node["Name"], $items("Name"). */
export function referencedNodeNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [/\$\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g, /\$\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g, /\$node\[\s*"((?:[^"\\]|\\.)*)"\s*\]/g, /\$node\[\s*'((?:[^'\\]|\\.)*)'\s*\]/g, /\$items\(\s*'((?:[^'\\]|\\.)*)'/g, /\$items\(\s*"((?:[^"\\]|\\.)*)"/g];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) names.add((m[1] as string).replace(/\\(.)/g, '$1'));
  }
  return [...names];
}

/** Walks every string inside a node's parameters. */
export function parameterStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) parameterStrings(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value as Record<string, unknown>)) parameterStrings(v, out);
  return out;
}

/** Nodes reachable from `start` following any connection type. */
export function reachableNodes(workflow: N8nWorkflow, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const outputs = workflow.connections[current];
    if (!outputs) continue;
    for (const byIndex of Object.values(outputs)) {
      for (const targets of byIndex) {
        for (const target of targets ?? []) {
          if (!seen.has(target.node)) {
            seen.add(target.node);
            queue.push(target.node);
          }
        }
      }
    }
  }
  return seen;
}

/** Removes a node and every connection that starts or ends at it. */
export function removeNode(workflow: N8nWorkflow, name: string): void {
  workflow.nodes = workflow.nodes.filter((n) => n.name !== name);
  delete workflow.connections[name];
  for (const outputs of Object.values(workflow.connections)) {
    for (const byIndex of Object.values(outputs)) {
      for (let i = 0; i < byIndex.length; i++) {
        const targets = byIndex[i];
        if (targets) byIndex[i] = targets.filter((t) => t.node !== name);
      }
    }
  }
}

/** Points every connection that targets `from` at `to` instead. */
export function retargetIncoming(workflow: N8nWorkflow, from: string, to: string): void {
  for (const outputs of Object.values(workflow.connections)) {
    for (const byIndex of Object.values(outputs)) {
      for (const targets of byIndex) {
        for (const target of targets ?? []) if (target.node === from) target.node = to;
      }
    }
  }
}
