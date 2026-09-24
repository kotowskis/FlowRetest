import type { MultipartPart } from './multipart.ts';

/** One line of /capture/requests.jsonl. Authorization is never stored, only its presence. */
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
  multipart?: MultipartPart[];
  rule: { id: string; kind: string };
  response: { status: number | 'close' };
}

/** Context written by the CLI before each case: /capture/current.json. */
export interface CaptureContext {
  version: string;
  case: string;
}

/** Request headers copied into the capture record; everything else is dropped. */
export const HEADER_ALLOWLIST = ['content-type', 'accept', 'content-length', 'x-flowretest-node'] as const;

/** Rule ids that carry a fixed kind; any other id is a service template. */
export function ruleKind(ruleId: string): string {
  if (ruleId.startsWith('user-stub:')) return 'user-stub';
  if (ruleId === 'generic-sink') return 'generic-sink';
  if (ruleId === 'block') return 'block';
  if (ruleId.startsWith('token')) return 'token';
  return 'template';
}
