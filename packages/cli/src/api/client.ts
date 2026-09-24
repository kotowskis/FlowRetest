import type { N8nWorkflow, RawExecution } from '@flowretest/core';

export interface ExecutionListPage {
  data: RawExecution[];
  nextCursor: string | null;
}

export class N8nApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, url: string) {
    super(`n8n API ${status} for ${url}: ${body.slice(0, 200)}`);
    this.name = 'N8nApiError';
    this.status = status;
    this.body = body;
  }
}

/** Thin client for the n8n public API v1. Retries transient errors; no other logic. */
export class N8nClient {
  private readonly base: string;
  private readonly apiKey: string;

  constructor(instanceUrl: string, apiKey: string) {
    this.base = `${instanceUrl.replace(/\/+$/, '')}/api/v1`;
    this.apiKey = apiKey;
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { headers: { 'X-N8N-API-KEY': this.apiKey, accept: 'application/json' } });
      if (res.ok) return (await res.json()) as T;
      const body = await res.text();
      lastError = new N8nApiError(res.status, body, url.toString());
      if (![429, 502, 503, 504].includes(res.status)) throw lastError;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    throw lastError;
  }

  getWorkflow(id: string): Promise<N8nWorkflow> {
    return this.get<N8nWorkflow>(`/workflows/${encodeURIComponent(id)}`);
  }

  listExecutions(options: { workflowId: string; status?: 'success' | 'error' | 'waiting'; limit?: number; cursor?: string; includeData?: boolean; startedAfter?: string }): Promise<ExecutionListPage> {
    return this.get<ExecutionListPage>('/executions', {
      workflowId: options.workflowId,
      status: options.status,
      limit: options.limit ?? 25,
      cursor: options.cursor,
      includeData: options.includeData ?? true,
      startedAfter: options.startedAfter,
    });
  }

  getExecution(id: string, options: { includeData?: boolean; ignoreDataSizeLimit?: boolean } = {}): Promise<RawExecution> {
    return this.get<RawExecution>(`/executions/${encodeURIComponent(id)}`, { includeData: options.includeData ?? true, ignoreDataSizeLimit: options.ignoreDataSizeLimit });
  }

  /** Best effort: the internal settings endpoint exposes versionCli; not part of the public API. */
  async detectVersion(instanceUrl: string): Promise<string | undefined> {
    try {
      const res = await fetch(`${instanceUrl.replace(/\/+$/, '')}/rest/settings`, { headers: { accept: 'application/json' } });
      if (!res.ok) return undefined;
      const json = (await res.json()) as { data?: { versionCli?: string }; versionCli?: string };
      return json.data?.versionCli ?? json.versionCli;
    } catch {
      return undefined;
    }
  }
}
