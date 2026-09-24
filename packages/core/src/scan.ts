import type { Classification } from './classify.ts';
import type { N8nNode, N8nWorkflow } from './n8n.ts';
import { parameterStrings, referencedNodeNames } from './n8n.ts';

export type Severity = 'info' | 'warn' | 'error';

export interface ScanFinding {
  rule: string;
  severity: Severity;
  node?: string;
  message: string;
}

export interface SupportRow {
  node: string;
  type: string;
  typeVersion: number;
  role: string;
  status: 'executed' | 'replayed' | 'replaced' | 'unsupported' | 'trigger' | 'removed';
  reachable: boolean;
  note?: string;
}

export interface ScanResult {
  support: SupportRow[];
  findings: ScanFinding[];
}

const PAIRING_BREAKERS = new Set(['n8n-nodes-base.merge', 'n8n-nodes-base.aggregate', 'n8n-nodes-base.summarize', 'n8n-nodes-base.code', 'n8n-nodes-base.itemLists', 'n8n-nodes-base.compareDatasets']);
const TOGGLES = ['executeOnce', 'alwaysOutputData', 'onError', 'continueOnFail', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'disabled'] as const;

function nodeMap(workflow: N8nWorkflow): Map<string, N8nNode> {
  return new Map(workflow.nodes.map((n) => [n.name, n]));
}

/** predecessors[node] = nodes with a connection into node */
function predecessors(workflow: N8nWorkflow): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [from, outputs] of Object.entries(workflow.connections)) {
    for (const byIndex of Object.values(outputs)) {
      for (const targets of byIndex) {
        for (const t of targets ?? []) {
          const set = out.get(t.node) ?? new Set<string>();
          set.add(from);
          out.set(t.node, set);
        }
      }
    }
  }
  return out;
}

/** True when some path from `from` to `to` (following connections backwards from `to`) crosses a pairing breaker. */
function pathCrossesBreaker(workflow: N8nWorkflow, from: string, to: string): boolean {
  const preds = predecessors(workflow);
  const nodes = nodeMap(workflow);
  const seen = new Set<string>();
  const stack: Array<{ node: string; crossed: boolean }> = [{ node: to, crossed: false }];
  while (stack.length) {
    const { node, crossed } = stack.pop() as { node: string; crossed: boolean };
    for (const p of preds.get(node) ?? []) {
      if (p === from) {
        if (crossed) return true;
        continue;
      }
      const key = `${p}|${crossed}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const type = nodes.get(p)?.type ?? '';
      stack.push({ node: p, crossed: crossed || PAIRING_BREAKERS.has(type) });
    }
  }
  return false;
}

function usesItemAccess(text: string, target: string): boolean {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\$\\(\\s*['"]${escaped}['"]\\s*\\)\\.item\\b`).test(text) || new RegExp(`\\$node\\[\\s*['"]${escaped}['"]\\s*\\]\\.json`).test(text);
}

/** localhost, any 127.x address, 0.0.0.0 and [::1]. */
const LOCAL_URL = /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])([:/]|$)/i;

/** Findings that concern one version on its own. */
export function scanWorkflow(workflow: N8nWorkflow, classification: Classification): ScanResult {
  const findings: ScanFinding[] = [];
  const names = new Set(workflow.nodes.map((n) => n.name));
  const support: SupportRow[] = workflow.nodes.map((node) => {
    const role = classification.roles[node.name] ?? 'unsupported';
    let status: SupportRow['status'] = 'executed';
    if (role === 'trigger') status = node.name === classification.triggerNode ? 'trigger' : 'removed';
    else if (role === 'read') status = 'replayed';
    else if (role === 'replace') status = 'replaced';
    else if (role === 'unsupported') status = 'unsupported';
    return { node: node.name, type: node.type, typeVersion: node.typeVersion, role, status, reachable: classification.reachable.has(node.name), note: classification.notes[node.name] };
  });

  for (const node of workflow.nodes) {
    const strings = parameterStrings(node.parameters);
    const joined = strings.join('\n');
    for (const ref of referencedNodeNames(joined)) {
      if (!names.has(ref)) findings.push({ rule: 'S002', severity: 'error', node: node.name, message: `expression refers to node "${ref}" which does not exist (renamed or deleted?)` });
      else if (usesItemAccess(joined, ref) && pathCrossesBreaker(workflow, ref, node.name)) findings.push({ rule: 'S005', severity: 'warn', node: node.name, message: `$('${ref}').item is read behind a Merge, Aggregate, Summarize or Code node; item pairing may point at the wrong record` });
    }
    if (node.type === 'n8n-nodes-base.httpRequest') {
      const opts = (node.parameters.options ?? {}) as Record<string, unknown>;
      if (typeof opts.proxy === 'string' && opts.proxy.trim() !== '') findings.push({ rule: 'S006', severity: 'error', node: node.name, message: 'HTTP Request has its own Proxy option; it would bypass the sandbox and is treated as unsupported' });
      // Expressions are stored with a leading `=` (`=http://localhost:5678/...`), so strip it before matching.
      const url = typeof node.parameters.url === 'string' ? node.parameters.url.replace(/^=\s*/, '') : '';
      if (LOCAL_URL.test(url)) findings.push({ rule: 'S013', severity: 'warn', node: node.name, message: `URL points at ${url.split('/')[2]}; inside the sandbox this bypasses the proxy and fails to connect` });
    }
    // $env works in any expression, not only in Code; the sandbox blocks it everywhere.
    if (node.type === 'n8n-nodes-base.code' ? /process\.env|\$env\b/.test(joined) : /\{\{[^}]*\$env\b/.test(joined)) findings.push({ rule: 'S008', severity: 'warn', node: node.name, message: `${node.type === 'n8n-nodes-base.code' ? 'Code' : 'An expression'} reads process.env or $env; the sandbox has no production environment (N8N_BLOCK_ENV_ACCESS_IN_NODE=true)` });
    if (node.disabled) findings.push({ rule: 'S011', severity: 'info', node: node.name, message: 'node is disabled and passes data through' });
  }
  for (const u of classification.unsupportedOnPath) findings.push({ rule: 'S000', severity: 'error', node: u, message: `unsupported node on the execution path (${classification.notes[u] ?? 'no role table'}); cases reaching it are skipped` });
  // S007: two IF or Filter nodes with identical conditions, a known editor slip when a branch is copied.
  const byConditions = new Map<string, string[]>();
  for (const node of workflow.nodes) {
    if (node.type !== 'n8n-nodes-base.if' && node.type !== 'n8n-nodes-base.filter') continue;
    const key = stableJson(node.parameters.conditions ?? null);
    byConditions.set(key, [...(byConditions.get(key) ?? []), node.name]);
  }
  for (const names of byConditions.values()) if (names.length > 1) findings.push({ rule: 'S007', severity: 'warn', node: names[0], message: `identical conditions in ${names.map((n) => `"${n}"`).join(' and ')}` });
  return { support, findings };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function edges(workflow: N8nWorkflow): Set<string> {
  const out = new Set<string>();
  for (const [from, outputs] of Object.entries(workflow.connections)) {
    for (const [type, byIndex] of Object.entries(outputs)) {
      byIndex.forEach((targets, outIndex) => {
        for (const t of targets ?? []) out.add(`${from}[${type}:${outIndex}] -> ${t.node}[${t.type}:${t.index}]`);
      });
    }
  }
  return out;
}

/** Findings about what changed between two versions. */
export function scanDiff(oldWorkflow: N8nWorkflow, newWorkflow: N8nWorkflow): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const oldNodes = nodeMap(oldWorkflow);
  const newNodes = nodeMap(newWorkflow);
  const oldById = new Map(oldWorkflow.nodes.filter((n) => n.id).map((n) => [n.id as string, n]));

  for (const node of newWorkflow.nodes) {
    const before = oldNodes.get(node.name) ?? (node.id ? oldById.get(node.id) : undefined);
    if (!before) {
      findings.push({ rule: 'S009', severity: 'info', node: node.name, message: 'node added' });
      continue;
    }
    if (before.name !== node.name) findings.push({ rule: 'S010', severity: 'warn', node: node.name, message: `node renamed from "${before.name}"; expressions that still say $('${before.name}') are dangling` });
    if (before.typeVersion !== node.typeVersion) findings.push({ rule: 'S001', severity: 'warn', node: node.name, message: `typeVersion ${before.typeVersion} -> ${node.typeVersion}; node behaviour may differ between versions` });
    if (before.type !== node.type) findings.push({ rule: 'S001', severity: 'warn', node: node.name, message: `type ${before.type} -> ${node.type}` });
    for (const key of TOGGLES) {
      const a = before[key];
      const b = node[key];
      if (stableJson(a ?? null) !== stableJson(b ?? null)) findings.push({ rule: 'S004', severity: 'warn', node: node.name, message: `${key}: ${JSON.stringify(a ?? false)} -> ${JSON.stringify(b ?? false)}` });
    }
    const oldCreds = before.credentials ?? {};
    const newCreds = node.credentials ?? {};
    for (const type of new Set([...Object.keys(oldCreds), ...Object.keys(newCreds)])) {
      const a = oldCreds[type];
      const b = newCreds[type];
      if ((a?.id ?? null) !== (b?.id ?? null)) findings.push({ rule: 'S003', severity: 'warn', node: node.name, message: `credential ${type}: ${a ? `${a.name ?? '?'} (${a.id ?? '?'})` : 'none'} -> ${b ? `${b.name ?? '?'} (${b.id ?? '?'})` : 'none'}` });
    }
    if (stableJson(before.parameters) !== stableJson(node.parameters)) findings.push({ rule: 'S012', severity: 'info', node: node.name, message: 'parameters changed' });
  }
  for (const node of oldWorkflow.nodes) {
    if (!newNodes.has(node.name) && !(node.id && newWorkflow.nodes.some((n) => n.id === node.id))) findings.push({ rule: 'S009', severity: 'info', node: node.name, message: 'node removed' });
  }
  const oldEdges = edges(oldWorkflow);
  const newEdges = edges(newWorkflow);
  for (const e of newEdges) if (!oldEdges.has(e)) findings.push({ rule: 'S009', severity: 'info', message: `connection added: ${e}` });
  for (const e of oldEdges) if (!newEdges.has(e)) findings.push({ rule: 'S009', severity: 'info', message: `connection removed: ${e}` });
  return findings;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export function sortFindings(findings: ScanFinding[]): ScanFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule.localeCompare(b.rule));
}

export function renderScan(result: ScanResult, diffFindings: ScanFinding[] = []): string {
  const lines: string[] = [];
  lines.push('Support table (new version):');
  const width = Math.max(4, ...result.support.map((r) => r.node.length));
  for (const r of result.support) {
    lines.push(`  ${r.node.padEnd(width)}  ${r.status.padEnd(11)} ${r.type}@${r.typeVersion}${r.reachable ? '' : '  (not reachable from the trigger)'}${r.note ? `  ${r.note}` : ''}`);
  }
  const all = sortFindings([...result.findings, ...diffFindings]);
  lines.push('');
  lines.push(all.length === 0 ? 'Findings: none' : `Findings (${all.length}):`);
  for (const f of all) lines.push(`  ${f.severity.padEnd(5)} ${f.rule} ${f.node ? `[${f.node}] ` : ''}${f.message}`);
  return lines.join('\n');
}
