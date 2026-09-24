/** Smallest workflow that proves interception: Manual Trigger, then one HTTPS GET. */
export const PROBE_WORKFLOW_NAME = 'frt/doctor/probe';
export const PROBE_WORKFLOW_ID = 'frtdoctorprobe01';
export const PROBE_URL = 'https://example.com/flowretest-probe';

export { workflowId } from "@flowretest/core";

export function buildProbeWorkflow(): Record<string, unknown> {
  return {
    id: PROBE_WORKFLOW_ID,
    name: PROBE_WORKFLOW_NAME,
    active: false,
    nodes: [
      {
        parameters: {},
        name: 'frt:start',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
      },
      {
        parameters: { url: PROBE_URL, options: {} },
        name: 'Probe',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [300, 0],
      },
    ],
    connections: {
      'frt:start': { main: [[{ node: 'Probe', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

/** Rules for the probe: answer the probe URL, sink writes, close everything else. */
export function buildProbeRules(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    rules: [
      { id: 'probe', match: { host: 'example.com', method: 'GET', path: '^/flowretest-probe$' }, respond: { status: 200, json: { probe: 'ok', seq: '{{seq}}' } } },
      { id: 'generic-sink', match: { method: 'POST|PUT|PATCH|DELETE' }, respond: { status: 200, json: { id: 'frt-{{seq}}', ok: true } } },
      { id: 'block', match: {}, respond: { close: true } },
    ],
  };
}

/**
 * n8n CLI commands print through the logger. With N8N_LOG_OUTPUT=console and
 * N8N_LOG_FORMAT=json every entry is one JSON line with a `message`; lines that
 * are not JSON (the entrypoint banner) are returned verbatim.
 */
export function logMessages(stdout: string): string[] {
  const out: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('{')) {
      try {
        const entry = JSON.parse(line) as { message?: unknown };
        if (typeof entry.message === 'string') {
          out.push(entry.message);
          continue;
        }
      } catch {
        // not a log entry, keep the raw line
      }
    }
    out.push(line);
  }
  return out;
}

/** Error-level messages from console JSON logging (N8N_LOG_FORMAT=json), deduplicated, in order. */
export function logErrors(stdout: string, limit = 5): string[] {
  const out: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      const entry = JSON.parse(line) as { level?: string; message?: unknown };
      if (entry.level === 'error' && typeof entry.message === 'string' && !out.includes(entry.message)) out.push(entry.message);
    } catch {
      // not a log entry
    }
  }
  return out.slice(-limit);
}

/** The run object printed by `n8n execute --rawOutput` (a logger message that is itself JSON). */
export function extractRun(stdout: string): Record<string, unknown> {
  for (const message of logMessages(stdout).reverse()) {
    const text = message.trim();
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      if (value && typeof value === 'object' && 'data' in value && 'mode' in value) return value;
    } catch {
      // keep looking
    }
  }
  return extractLastJson(stdout) as Record<string, unknown>;
}

/** Parses `n8n list:workflow` output (`id|name` per logger message). */
export function parseWorkflowList(stdout: string): Array<{ id: string; name: string }> {
  return logMessages(stdout)
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
    .map((line) => {
      const idx = line.indexOf('|');
      return { id: line.slice(0, idx).trim(), name: line.slice(idx + 1).trim() };
    })
    .filter((row) => row.id !== '' && !/^id$/i.test(row.id));
}

/** Finds the last complete JSON object in a stdout stream (logs may precede it). */
export function extractLastJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed === '') throw new Error('empty stdout, expected JSON from --rawOutput');
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to a scan for the last top-level object
  }
  let depth = 0;
  let end = -1;
  let start = -1;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch === '}') {
      if (depth === 0) end = i;
      depth++;
    } else if (ch === '{') {
      depth--;
      if (depth === 0) {
        start = i;
        break;
      }
    }
  }
  if (start === -1 || end === -1) throw new Error('no JSON object found in stdout');
  return JSON.parse(trimmed.slice(start, end + 1));
}
