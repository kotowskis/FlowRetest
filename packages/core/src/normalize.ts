import { createHash } from 'node:crypto';
import type { Attribution, CaptureRecord } from './capture.ts';

export interface NormalizeOptions {
  /** Dot paths inside the body replaced by `<ignored>`, e.g. `properties.last_activity`; `*` matches one segment. */
  ignorePaths?: string[];
  /** Regular expression sources; a path segment matching one becomes `{id}`. */
  idSegments?: string[];
  /** Placeholders applied to string values; defaults cover timestamps, uuids, tokens. */
  placeholders?: boolean;
}

export interface NormalizedCall {
  version: string;
  caseId: string;
  node: string;
  runIndex: number;
  ts: number;
  method: string;
  host: string;
  /** Path with id-like segments replaced by `{id}` / `{email}`. */
  pathTemplate: string;
  path: string;
  query: Record<string, string>;
  contentType?: string;
  body: unknown;
  bodyHash: string;
  multipart?: Array<{ name: string; filename?: string; size: number; sha256: string }>;
  rule: { id: string; kind: string };
  blocked: boolean;
  /** Identity for matching old against new: node, method, host and path template. */
  key: string;
}

export const DEFAULT_ID_SEGMENTS = ['^\\d+$', '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$', '^rec[A-Za-z0-9]{14}$', '^[0-9a-f]{24}$', '^[0-9a-f]{32}$'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EPOCH = /^\d{10}(\d{3})?$/;
const BEARER = /^(Bearer|Basic|Token)\s+\S+$/i;
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

export function placeholderFor(value: string): string | undefined {
  if (ISO_DATE.test(value)) return '<ts>';
  if (UUID.test(value)) return '<uuid>';
  if (EPOCH.test(value)) {
    const n = Number(value.length === 13 ? value.slice(0, 10) : value);
    if (n > 1_400_000_000 && n < 2_200_000_000) return '<epoch>';
  }
  if (BEARER.test(value)) return '<token>';
  return undefined;
}

function segmentMatches(segment: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(segment));
}

export function templatePath(path: string, idSegments: string[] = DEFAULT_ID_SEGMENTS): string {
  const patterns = idSegments.map((s) => new RegExp(s));
  return path
    .split('/')
    .map((segment) => {
      if (segment === '') return segment;
      const decoded = safeDecode(segment);
      if (EMAIL.test(decoded)) return '{email}';
      if (segmentMatches(decoded, patterns)) return '{id}';
      return segment;
    })
    .join('/');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function pathMatches(pattern: string[], path: string[]): boolean {
  if (pattern.length !== path.length) return false;
  return pattern.every((p, i) => p === '*' || p === path[i]);
}

export function canonicalize(value: unknown, options: { ignore: string[][]; placeholders: boolean }, path: string[] = []): unknown {
  if (options.ignore.some((p) => pathMatches(p, path))) return '<ignored>';
  if (typeof value === 'string') return (options.placeholders ? placeholderFor(value) : undefined) ?? value;
  if (typeof value === 'number' && Number.isInteger(value) && options.placeholders && placeholderFor(String(value)) === '<epoch>') return '<epoch>';
  if (Array.isArray(value)) return value.map((v, i) => canonicalize(v, options, [...path, String(i)]));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = canonicalize((value as Record<string, unknown>)[key], options, [...path, key]);
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

export function hashBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body ?? null)).digest('hex').slice(0, 16);
}

export function normalizeCall(record: CaptureRecord, attribution: Attribution, options: NormalizeOptions = {}): NormalizedCall {
  const ignore = (options.ignorePaths ?? []).map((p) => p.replace(/^\$\./, '').split('.'));
  const placeholders = options.placeholders ?? true;
  const pathTemplate = templatePath(record.path, options.idSegments);
  const body = record.multipart ? { multipart: record.multipart.map((p) => ({ name: p.name, filename: p.filename, size: p.size, sha256: p.sha256 })) } : canonicalize(record.bodyJson ?? (record.body ? { text: record.body } : null), { ignore, placeholders });
  const query: Record<string, string> = {};
  for (const key of Object.keys(record.query).sort()) query[key] = (placeholders ? placeholderFor(record.query[key] ?? '') : undefined) ?? (record.query[key] as string);
  const method = record.method.toUpperCase();
  const host = record.host.toLowerCase();
  return {
    version: record.version,
    caseId: record.case,
    node: attribution.node,
    runIndex: attribution.runIndex,
    ts: record.ts,
    method,
    host,
    pathTemplate,
    path: record.path,
    query,
    contentType: record.contentType,
    body,
    bodyHash: hashBody({ body, query }),
    multipart: record.multipart,
    rule: record.rule,
    blocked: record.response.status === 'close',
    key: `${attribution.node}|${method}|${host}|${pathTemplate}`,
  };
}

/** Flattens a canonical body into path -> primitive pairs for field-level diffs. */
export function flatten(value: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix || '$', '[]');
    value.forEach((v, i) => flatten(v, prefix ? `${prefix}[${i}]` : `[${i}]`, out));
  } else if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out.set(prefix || '$', '{}');
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix || '$', value);
  }
  return out;
}
