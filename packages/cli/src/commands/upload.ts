import { readFileSync } from 'node:fs';
import { redactionProblems } from '@flowretest/core';
import { parseOrThrow, RedactedReportSchema } from '@flowretest/schemas';
import { cloudRequest, cloudToken, cloudUrl } from '../cloud.ts';
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

/** Largest body the hosted layer accepts; checked here too so a big report fails before the upload, not after. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Redacts the run's report and sends the redacted copy with the workspace token. The body is checked with the same
 * schema and the same redaction guard the server uses, so a report that would be refused is never sent at all.
 */
export async function runUpload(options: UploadOptions): Promise<UploadResult> {
  const base = cloudUrl(options.cwd, options.url);
  const token = cloudToken(options.cwd);
  const file = runRedactReport({ cwd: options.cwd, workflowId: options.workflowId, run: options.run, log: options.log });
  const body = readFileSync(file, 'utf8');
  if (Buffer.byteLength(body) > MAX_UPLOAD_BYTES) throw new Error(`redacted report is ${Math.round(Buffer.byteLength(body) / 1024)} KB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit; upload fewer cases with \`run --cases\``);
  const report = parseOrThrow(RedactedReportSchema, JSON.parse(body), 'redacted report');
  const problems = redactionProblems(report);
  if (problems.length > 0) throw new Error(`redacted report still carries values, not uploading: ${problems.slice(0, 3).join('; ')}`);

  const json = await cloudRequest<{ id: string; url: string; status: string }>(base, token, '/api/runs', { method: 'POST', body });
  const result = { id: String(json.id), url: String(json.url), status: String(json.status), file };
  options.log(`uploaded run ${result.id} (${result.status}): ${result.url}`);
  return result;
}
