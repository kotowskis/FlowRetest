/** One line of the proxy's requests.jsonl, as core consumes it. Mirrors packages/proxy/src/capture.ts without importing it. */
export interface CaptureRecord {
  ts: number;
  version: string;
  case: string;
  method: string;
  host: string;
  port: number;
  path: string;
  /** A parameter sent more than once keeps every value, in order. */
  query: Record<string, string | string[]>;
  contentType?: string;
  headers: Record<string, string>;
  body?: string;
  bodyJson?: unknown;
  bodyBytes: number;
  bodySha256: string;
  multipart?: Array<{ name: string; filename?: string; contentType?: string; size: number; sha256: string }>;
  rule: { id: string; kind: string };
  response: { status: number | 'close' };
}

export interface NodeRunWindow {
  node: string;
  runIndex: number;
  start: number;
  end: number;
}

/** Minimal runData shape needed for timing and input counts. */
export type RunTimings = Record<
  string,
  Array<{
    startTime?: number;
    executionTime?: number;
    source?: Array<{ previousNode?: string; previousNodeOutput?: number; previousNodeRun?: number } | null>;
    data?: { main?: Array<Array<unknown> | null> };
  }>
>;

/** Items that entered each node, summed over its runs, derived from the previous node's recorded output. */
export function inputCounts(runData: RunTimings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [node, runs] of Object.entries(runData)) {
    let total = 0;
    for (const run of runs) {
      const src = run.source?.[0];
      if (!src?.previousNode) continue;
      const prevRuns = runData[src.previousNode];
      if (!prevRuns || prevRuns.length === 0) continue;
      const prevRun = prevRuns[src.previousNodeRun ?? prevRuns.length - 1] ?? prevRuns[prevRuns.length - 1];
      total += prevRun?.data?.main?.[src.previousNodeOutput ?? 0]?.length ?? 0;
    }
    out[node] = total;
  }
  return out;
}

export function runWindows(runData: RunTimings): NodeRunWindow[] {
  const windows: NodeRunWindow[] = [];
  for (const [node, runs] of Object.entries(runData)) {
    runs.forEach((run, runIndex) => {
      if (typeof run.startTime !== 'number') return;
      windows.push({ node, runIndex, start: run.startTime, end: run.startTime + Math.max(run.executionTime ?? 0, 0) });
    });
  }
  return windows.sort((a, b) => a.start - b.start);
}

export interface Attribution {
  node: string;
  runIndex: number;
}

/**
 * Attributes a request to the node run whose time window contains it. n8n
 * runs nodes of one execution sequentially, so windows do not overlap; a
 * tolerance absorbs clock granularity and the hop through the proxy.
 */
/** Prefers the node named in the X-FlowRetest-Node header; the run index still comes from timing. */
export function attributeRecord(record: { ts: number; headers: Record<string, string> }, windows: NodeRunWindow[], toleranceMs = 25): Attribution {
  const tagged = decodeNodeTag(record.headers['x-flowretest-node']);
  const byTime = attributeToNode(record.ts, windows, toleranceMs);
  if (!tagged) return byTime;
  if (byTime.node === tagged) return byTime;
  const runsOfNode = windows.filter((w) => w.node === tagged);
  const containing = runsOfNode.find((w) => record.ts >= w.start - toleranceMs && record.ts <= w.end + toleranceMs);
  return { node: tagged, runIndex: containing ? containing.runIndex : runsOfNode.length === 1 ? (runsOfNode[0] as NodeRunWindow).runIndex : -1 };
}

/** The rewriter percent-encodes node names in the tag header (HTTP header values must be Latin-1). */
export function decodeNodeTag(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function attributeToNode(ts: number, windows: NodeRunWindow[], toleranceMs = 25): Attribution {
  // Windows of one execution are contiguous and never overlap, so a strict hit is unambiguous.
  const strict = windows.filter((w) => ts >= w.start && ts < Math.max(w.end, w.start + 1));
  if (strict.length > 0) {
    const best = strict.reduce((a, b) => (b.start > a.start ? b : a));
    return { node: best.node, runIndex: best.runIndex };
  }
  // Otherwise the nearest window within the tolerance (clock granularity, proxy hop).
  let best: NodeRunWindow | undefined;
  let bestDistance = Infinity;
  for (const w of windows) {
    const distance = ts < w.start ? w.start - ts : ts - w.end;
    if (distance <= toleranceMs && distance < bestDistance) {
      best = w;
      bestDistance = distance;
    }
  }
  if (best) return { node: best.node, runIndex: best.runIndex };
  return { node: '?', runIndex: -1 };
}
