import { readFileSync } from 'node:fs';
import { redactionProblems } from '@flowretest/core';
import { parseOrThrow, RedactedReportSchema } from '@flowretest/schemas';
import { loadConfig, loadSecret } from '../config.ts';
import { CLI_VERSION } from '../index.ts';
import { runRedactReport } from './redact.ts';

export interface UploadOptions {
  cwd: string;
  workflowId: string;
  run?: string;
  /** Hosted layer URL; default FLOWRETEST_URL, then `cloud.url` in config.yml. */
  url?: string;
  log: (line: string) => void;
}

export interface UploadResult {
  id: string;
  url: string;
  status: string;
  /** The redacted file that was sent; the full report never leaves the machine. */
  file: string;
}

export class UploadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

/** Largest body the hosted layer accepts; checked here too so a big report fails before the upload, not after. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function cloudUrl(cwd: string, explicit?: string): string {
  const url = explicit ?? process.env.FLOWRETEST_URL ?? loadConfig(cwd).cloud?.url;
  if (!url) throw new Error('no hosted layer URL: pass --url, set FLOWRETEST_URL or add `cloud: { url: ... }` to .flowretest/config.yml');
  return url.replace(/\/+$/, '');
}

/**
 * Redacts the run's report and sends the redacted copy with the workspace token. The body is checked with the same
 * schema and the same redaction guard the server uses, so a report that would be refused is never sent at all.
 */
export async function runUpload(options: UploadOptions): Promise<UploadResult> {
  const base = cloudUrl(options.cwd, options.url);
  const token = loadSecret(options.cwd, 'FLOWRETEST_TOKEN');
  if (!token) throw new Error('no workspace token: set FLOWRETEST_TOKEN (create one on the workspace page of the hosted layer)');
  const file = runRedactReport({ cwd: options.cwd, workflowId: options.workflowId, run: options.run, log: options.log });
  const body = readFileSync(file, 'utf8');
  if (Buffer.byteLength(body) > MAX_UPLOAD_BYTES) throw new Error(`redacted report is ${Math.round(Buffer.byteLength(body) / 1024)} KB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit; upload fewer cases with \`run --cases\``);
  const report = parseOrThrow(RedactedReportSchema, JSON.parse(body), 'redacted report');
  const problems = redactionProblems(report);
  if (problems.length > 0) throw new Error(`redacted report still carries values, not uploading: ${problems.slice(0, 3).join('; ')}`);

  let res: Response;
  try {
    res = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': `flowretest/${CLI_VERSION}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Error(`upload to ${base} failed`, { cause: e });
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // An HTML error page from a proxy; the status says enough.
  }
  if (!res.ok) {
    const reason = typeof json.error === 'string' ? json.error : text.slice(0, 200);
    const hint = res.status === 401 ? ' (the token is wrong or revoked)' : '';
    throw new UploadError(res.status, `upload refused with ${res.status}${hint}: ${reason}`);
  }
  const result = { id: String(json.id), url: String(json.url), status: String(json.status), file };
  options.log(`uploaded run ${result.id} (${result.status}): ${result.url}`);
  return result;
}
