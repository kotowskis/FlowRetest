/**
 * Sandbox proxy. Runs inside the internal Docker network next to n8n.
 * Reads rules from RULES_PATH, the current case from CAPTURE_DIR/current.json,
 * appends one JSON line per request to CAPTURE_DIR/requests.jsonl and never
 * forwards anything upstream: unmatched requests get their connection closed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateCACertificate, getLocal, type CompletedRequest, type Mockttp } from 'mockttp';
import { decide, parseRulesFile, RuleState, type Rule } from './rules.ts';
import { multipartBoundary, parseMultipart } from './multipart.ts';
import { HEADER_ALLOWLIST, ruleKind, type CaptureContext, type CaptureRecord } from './capture.ts';

export interface ProxyConfig {
  port: number;
  rulesPath: string;
  captureDir: string;
  caDir: string;
  /** Bodies above this size are hashed and sized, not stored. */
  maxStoredBody: number;
}

export const DEFAULT_CONFIG: ProxyConfig = {
  port: Number(process.env.PORT ?? 8080),
  rulesPath: process.env.RULES_PATH ?? '/rules/rules.json',
  captureDir: process.env.CAPTURE_DIR ?? '/capture',
  caDir: process.env.CA_DIR ?? '/ca',
  maxStoredBody: Number(process.env.MAX_STORED_BODY ?? 256 * 1024),
};

export const CA_CERT_FILE = 'flowretest-ca.pem';
export const CA_KEY_FILE = 'flowretest-ca.key';

export async function loadOrCreateCa(caDir: string): Promise<{ key: string; cert: string; created: boolean }> {
  mkdirSync(caDir, { recursive: true });
  const certPath = join(caDir, CA_CERT_FILE);
  const keyPath = join(caDir, CA_KEY_FILE);
  if (existsSync(certPath) && existsSync(keyPath)) {
    return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8'), created: false };
  }
  const ca = await generateCACertificate({
    subject: { commonName: 'FlowRetest sandbox CA', organizationName: 'FlowRetest' },
  });
  writeFileSync(keyPath, ca.key, { mode: 0o600 });
  writeFileSync(certPath, ca.cert);
  return { key: ca.key, cert: ca.cert, created: true };
}

/** Re-reads a JSON file only when its mtime changed; bind mounts do not reliably emit fs events. */
class FileCache<T> {
  private mtime = -1;
  private value: T;
  private readonly path: string;
  private readonly parse: (text: string) => T;
  private readonly fallback: T;

  constructor(path: string, parse: (text: string) => T, fallback: T) {
    this.path = path;
    this.parse = parse;
    this.fallback = fallback;
    this.value = fallback;
  }

  get(): T {
    try {
      const stat = statSync(this.path);
      if (stat.mtimeMs !== this.mtime) {
        this.value = this.parse(readFileSync(this.path, 'utf8'));
        this.mtime = stat.mtimeMs;
      }
    } catch {
      this.value = this.fallback;
      this.mtime = -1;
    }
    return this.value;
  }
}

/** Keeps every value of a repeated key (`?tag=a&tag=b`), in order. */
export function multiValues(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length === 1 ? (all[0] as string) : all;
  }
  return out;
}

/** JSON.parse that keeps integers beyond 2^53 as their exact digits (64-bit ids would otherwise collapse). */
export function parseJsonExact(text: string): unknown {
  return JSON.parse(text, (_key, value, context?: { source?: string }) =>
    typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) && context?.source ? context.source : value,
  );
}

function pickHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = headers[name];
    if (typeof value === 'string') out[name] = value;
  }
  out['x-frt-has-authorization'] = String(headers.authorization !== undefined);
  return out;
}

export async function startProxy(config: ProxyConfig = DEFAULT_CONFIG): Promise<Mockttp> {
  const ca = await loadOrCreateCa(config.caDir);
  mkdirSync(config.captureDir, { recursive: true });
  const capturePath = join(config.captureDir, 'requests.jsonl');
  const rules = new FileCache<Rule[]>(config.rulesPath, (text) => parseRulesFile(text).rules, []);
  const context = new FileCache<CaptureContext>(
    join(config.captureDir, 'current.json'),
    (text) => JSON.parse(text) as CaptureContext,
    { version: '?', case: '?' },
  );
  const state = new RuleState();

  const server = getLocal({
    https: { key: ca.key, cert: ca.cert },
    http2: false,
    recordTraffic: false,
    suggestChanges: false,
    cors: false,
  });

  await server.forAnyRequest().thenCallback(async (req: CompletedRequest) => {
    const url = new URL(req.url);
    // An encoding the proxy cannot decode keeps the raw bytes, so the body is still sized and hashed.
    const decoded = await req.body.getDecodedBuffer().catch(() => undefined);
    const buffer = decoded ?? req.body.buffer ?? Buffer.alloc(0);
    const contentType = req.headers['content-type'];
    const ctx = context.get();
    let bodyJson: unknown;
    let bodyText: string | undefined;
    let multipart: CaptureRecord['multipart'];
    const boundary = multipartBoundary(contentType);
    if (boundary) {
      multipart = parseMultipart(buffer, boundary);
    } else if (buffer.length <= config.maxStoredBody) {
      bodyText = buffer.toString('utf8');
      if (contentType?.includes('json')) {
        try {
          bodyJson = parseJsonExact(bodyText);
        } catch {
          bodyJson = undefined;
        }
      } else if (contentType?.includes('application/x-www-form-urlencoded')) {
        bodyJson = multiValues(new URLSearchParams(bodyText));
      }
    }

    const decision = decide(rules.get(), { method: req.method, host: url.hostname, path: url.pathname, bodyJson, bodyText, scope: ctx.version }, state);
    const record: CaptureRecord = {
      ts: Date.now(),
      version: ctx.version,
      case: ctx.case,
      method: req.method.toUpperCase(),
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      path: url.pathname,
      query: multiValues(url.searchParams),
      contentType,
      headers: pickHeaders(req.headers),
      body: bodyText,
      bodyJson,
      bodyBytes: buffer.length,
      bodySha256: createHash('sha256').update(buffer).digest('hex'),
      multipart,
      rule: decision.kind === 'none' ? { id: 'none', kind: 'block' } : { id: decision.rule.id, kind: ruleKind(decision.rule.id) },
      response: { status: decision.kind === 'respond' ? decision.response.status : 'close' },
    };
    appendFileSync(capturePath, JSON.stringify(record) + '\n');

    if (decision.kind !== 'respond') return 'close';
    return { statusCode: decision.response.status, headers: decision.response.headers, body: decision.response.body };
  });

  await server.start(config.port);
  return server;
}
