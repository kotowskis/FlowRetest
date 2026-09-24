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

/** Query values: a key sent more than once keeps every value, in order. */
export type QueryValues = Record<string, string | string[]>;

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
  /** The concrete path as compared: placeholders applied to generated segments (uuids, timestamps), real ids kept. */
  pathValue?: string;
  query: QueryValues;
  contentType?: string;
  body: unknown;
  bodyHash: string;
  multipart?: Array<{ name: string; filename?: string; contentType?: string; size: number; sha256: string }>;
  rule: { id: string; kind: string };
  blocked: boolean;
  /** Identity for matching old against new: node, method, host and path template. */
  key: string;
}

export const DEFAULT_ID_SEGMENTS = ['^\\d+$', '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$', '^rec[A-Za-z0-9]{14}$', '^[0-9a-f]{24}$', '^[0-9a-f]{32}$'];

/** A timestamp with a time part; a bare date (a due date, a birthday) is a real value and stays. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EPOCH = /^\d{10}(\d{3})?$/;
const BEARER = /^(Bearer|Basic|Token)\s+\S+$/i;
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
/** Words of a key name that mark a time field: created_at, updatedAt, expires, ts, iat. */
const TIME_WORDS = new Set(['ts', 'time', 'timestamp', 'date', 'datetime', 'created', 'updated', 'modified', 'expires', 'expiry', 'exp', 'iat', 'nbf', 'at', 'on', 'since', 'until']);
/** An epoch value this close to the request time was generated during the run. */
const NEAR_NOW_SECONDS = 2 * 24 * 3600;

export interface PlaceholderContext {
  /** Name of the field or query parameter holding the value. */
  key?: string;
  /** Request time in ms; an epoch value near it was generated during the run. */
  now?: number;
}

function isTimeKey(key: string | undefined): boolean {
  if (!key) return false;
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
  return words.some((w) => TIME_WORDS.has(w));
}

/**
 * Placeholder for a value generated during the run, or undefined for a real value. A 10 or 13 digit number is an
 * epoch only under a time-like key or near the request time; otherwise it is an id (Telegram chat_id, CRM ids).
 */
export function placeholderFor(value: string, context: PlaceholderContext = {}): string | undefined {
  if (ISO_DATETIME.test(value)) return '<ts>';
  if (UUID.test(value)) return '<uuid>';
  if (EPOCH.test(value)) {
    const seconds = Number(value.length === 13 ? value.slice(0, 10) : value);
    const inRange = seconds > 1_400_000_000 && seconds < 2_200_000_000;
    const nearNow = context.now !== undefined && Math.abs(seconds - context.now / 1000) < NEAR_NOW_SECONDS;
    if (inRange && (isTimeKey(context.key) || nearNow)) return '<epoch>';
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

/** The concrete path with generated segments replaced; ids stay, so a call to the wrong record shows up. */
export function pathValueOf(path: string, now?: number): string {
  return path
    .split('/')
    .map((segment) => (segment === '' ? segment : (placeholderFor(safeDecode(segment), { now }) ?? segment)))
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

export interface CanonicalizeOptions {
  ignore: string[][];
  placeholders: boolean;
  /** Request time in ms, for epoch values generated during the run. */
  now?: number;
}

function lastKey(path: string[]): string | undefined {
  for (let i = path.length - 1; i >= 0; i--) if (!/^\d+$/.test(path[i] as string)) return path[i];
  return undefined;
}

export function canonicalize(value: unknown, options: CanonicalizeOptions, path: string[] = []): unknown {
  if (options.ignore.some((p) => pathMatches(p, path))) return '<ignored>';
  const context = { key: lastKey(path), now: options.now };
  if (typeof value === 'string') return (options.placeholders ? placeholderFor(value, context) : undefined) ?? value;
  if (typeof value === 'number' && Number.isInteger(value) && options.placeholders && placeholderFor(String(value), context) === '<epoch>') return '<epoch>';
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

/** Media type without parameters (charset, multipart boundary). */
export function mediaTypeOf(contentType: string | undefined): string | undefined {
  const media = contentType?.split(';')[0]?.trim().toLowerCase();
  return media ? media : undefined;
}

/** Everything a call is compared on besides its key: concrete path, query, media type and body. */
export function callHash(call: Pick<NormalizedCall, 'body' | 'query' | 'path' | 'pathValue' | 'contentType'>): string {
  return hashBody({ body: call.body, query: call.query, path: call.pathValue ?? call.path, media: mediaTypeOf(call.contentType) ?? null });
}

function normalizeQuery(query: CaptureRecord['query'], placeholders: boolean, now: number): QueryValues {
  const out: QueryValues = {};
  const one = (key: string, value: string) => (placeholders ? placeholderFor(value, { key, now }) : undefined) ?? value;
  for (const key of Object.keys(query).sort()) {
    const value = query[key] as string | string[];
    out[key] = Array.isArray(value) ? value.map((v) => one(key, v)) : one(key, value);
  }
  return out;
}

/** Body as compared. A body the proxy did not store (over its size limit) is compared by size and hash. */
function bodyOf(record: CaptureRecord, ignore: string[][], placeholders: boolean): unknown {
  if (record.multipart) return { multipart: record.multipart.map((p) => ({ name: p.name, filename: p.filename, size: p.size, sha256: p.sha256 })) };
  if (record.bodyJson !== undefined) return canonicalize(record.bodyJson, { ignore, placeholders, now: record.ts });
  if (record.body) return canonicalize({ text: record.body }, { ignore, placeholders, now: record.ts });
  if (record.bodyBytes > 0) return { '@unstored': { bytes: record.bodyBytes, sha256: record.bodySha256 } };
  return null;
}

export function normalizeCall(record: CaptureRecord, attribution: Attribution, options: NormalizeOptions = {}): NormalizedCall {
  const ignore = (options.ignorePaths ?? []).map((p) => p.replace(/^\$\./, '').split('.'));
  const placeholders = options.placeholders ?? true;
  const pathTemplate = templatePath(record.path, options.idSegments);
  const pathValue = placeholders ? pathValueOf(record.path, record.ts) : record.path;
  const body = bodyOf(record, ignore, placeholders);
  const query = normalizeQuery(record.query, placeholders, record.ts);
  const method = record.method.toUpperCase();
  const host = record.host.toLowerCase();
  const call = {
    version: record.version,
    caseId: record.case,
    node: attribution.node,
    runIndex: attribution.runIndex,
    ts: record.ts,
    method,
    host,
    pathTemplate,
    path: record.path,
    pathValue,
    query,
    contentType: record.contentType,
    body,
    multipart: record.multipart,
    rule: record.rule,
    blocked: record.response.status === 'close',
    key: `${attribution.node}|${method}|${host}|${pathTemplate}`,
  };
  return { ...call, bodyHash: callHash(call) };
}

/** Object keys that would be ambiguous in dot notation (dots, brackets, quotes, a leading @ or ?) are written as `["key"]`. */
function keySegment(key: string, prefix: string): string {
  if (/[.[\]"]/.test(key) || /^[@?]/.test(key) || key === '') return `${prefix}[${JSON.stringify(key)}]`;
  return prefix ? `${prefix}.${key}` : key;
}

/** Flattens a canonical body into path -> primitive pairs for field-level diffs. */
export function flatten(value: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix || '$', '[]');
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out.set(prefix || '$', '{}');
    for (const [k, v] of entries) flatten(v, keySegment(k, prefix), out);
  } else {
    out.set(prefix || '$', value);
  }
  return out;
}

/** Splits a flatten() path back into segments: `a.b[2]["c.d"]` -> a, b, 2, c.d. */
export function splitFlatPath(path: string): string[] {
  const out: string[] = [];
  const re = /\["((?:[^"\\]|\\.)*)"\]|\[(\d+)\]|\.?([^.[\]]+)/g;
  for (let m = re.exec(path); m; m = re.exec(path)) {
    if (m[1] !== undefined) out.push(JSON.parse(`"${m[1]}"`) as string);
    else if (m[2] !== undefined) out.push(m[2]);
    else if (m[3] !== undefined) out.push(m[3]);
  }
  return out;
}
