/**
 * Pure rules engine of the sandbox proxy. No IO here: the server feeds it a
 * request summary and gets back what to answer. The CLI generates the rules
 * file; the proxy only evaluates it, so everything derived from a recording
 * (for example a sheet header row) is precomputed by the CLI.
 */

export interface RuleMatch {
  /** Exact host (case-insensitive) or a regular expression source when it starts with `^`. */
  host?: string;
  /** Regular expression source matched against the upper-cased method, e.g. `POST|PUT`. */
  method?: string;
  /** Regular expression source matched against the path (without query). */
  path?: string;
}

export interface RuleResponse {
  status?: number;
  headers?: Record<string, string>;
  /** JSON body; string values may contain template functions. */
  json?: unknown;
  /** Raw text body; used when `json` is absent. */
  body?: string;
  /** Close the connection instead of answering (BLOCKED). */
  close?: boolean;
}

export interface Rule {
  id: string;
  match: RuleMatch;
  respond: RuleResponse;
  /** Consume the rule after this many matches; unlimited when absent. */
  times?: number;
}

export interface RulesFile {
  schemaVersion: 1;
  rules: Rule[];
}

export interface RequestSummary {
  method: string;
  host: string;
  path: string;
  bodyJson?: unknown;
}

export interface RenderedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type RuleDecision =
  | { kind: 'respond'; rule: Rule; response: RenderedResponse }
  | { kind: 'close'; rule: Rule }
  | { kind: 'none' };

/** Mutable per-run state: sequence counters and consumed `times`. */
export class RuleState {
  readonly seq = new Map<string, number>();
  readonly used = new Map<string, number>();

  nextSeq(ruleId: string): number {
    const next = (this.seq.get(ruleId) ?? 0) + 1;
    this.seq.set(ruleId, next);
    return next;
  }

  consume(rule: Rule): void {
    this.used.set(rule.id, (this.used.get(rule.id) ?? 0) + 1);
  }

  exhausted(rule: Rule): boolean {
    return rule.times !== undefined && (this.used.get(rule.id) ?? 0) >= rule.times;
  }
}

export function ruleMatches(rule: Rule, req: RequestSummary): boolean {
  const { host, method, path } = rule.match;
  if (host !== undefined) {
    if (host.startsWith('^')) {
      if (!new RegExp(host, 'i').test(req.host)) return false;
    } else if (host.toLowerCase() !== req.host.toLowerCase()) {
      return false;
    }
  }
  if (method !== undefined && !new RegExp(`^(?:${method})$`, 'i').test(req.method)) return false;
  if (path !== undefined && !new RegExp(path).test(req.path)) return false;
  return true;
}

/** First rule that matches and is not exhausted; order in the file is priority. */
export function selectRule(rules: Rule[], req: RequestSummary, state: RuleState): Rule | undefined {
  return rules.find((rule) => !state.exhausted(rule) && ruleMatches(rule, req));
}

function lookupPath(root: unknown, dotted: string): unknown {
  let current: unknown = root;
  for (const segment of dotted.split('.')) {
    if (segment === '') continue;
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

const WHOLE_TEMPLATE = /^\{\{\s*(seq|uuid|now|echo)(?:\s+([^}]+?))?\s*\}\}$/;
const INLINE_TEMPLATE = /\{\{\s*(seq|uuid|now|echo)(?:\s+([^}]+?))?\s*\}\}/g;

interface RenderContext {
  ruleId: string;
  state: RuleState;
  req: RequestSummary;
  uuid: () => string;
  now: () => string;
}

function renderTemplate(fn: string, arg: string | undefined, ctx: RenderContext): unknown {
  switch (fn) {
    case 'seq':
      return String(ctx.state.nextSeq(ctx.ruleId));
    case 'uuid':
      return ctx.uuid();
    case 'now':
      return ctx.now();
    case 'echo': {
      const source = arg ?? 'body';
      const [rootName, ...rest] = source.split('.');
      if (rootName !== 'body') return undefined;
      return lookupPath(ctx.req.bodyJson, rest.join('.'));
    }
    default:
      return undefined;
  }
}

function renderValue(value: unknown, ctx: RenderContext): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_TEMPLATE.exec(value);
    if (whole) return renderTemplate(whole[1] as string, whole[2], ctx);
    return value.replace(INLINE_TEMPLATE, (_match, fn: string, arg: string | undefined) => {
      const rendered = renderTemplate(fn, arg, ctx);
      if (rendered === undefined || rendered === null) return '';
      return typeof rendered === 'string' ? rendered : JSON.stringify(rendered);
    });
  }
  if (Array.isArray(value)) return value.map((v) => renderValue(v, ctx));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderValue(v, ctx);
    return out;
  }
  return value;
}

export interface RenderOptions {
  uuid?: () => string;
  now?: () => string;
}

export function renderResponse(rule: Rule, req: RequestSummary, state: RuleState, options: RenderOptions = {}): RenderedResponse {
  const ctx: RenderContext = {
    ruleId: rule.id,
    state,
    req,
    uuid: options.uuid ?? (() => crypto.randomUUID()),
    now: options.now ?? (() => new Date().toISOString()),
  };
  const headers: Record<string, string> = { ...(rule.respond.headers ?? {}) };
  let body = '';
  if (rule.respond.json !== undefined) {
    body = JSON.stringify(renderValue(rule.respond.json, ctx));
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  } else if (rule.respond.body !== undefined) {
    body = rule.respond.body;
  }
  return { status: rule.respond.status ?? 200, headers, body };
}

export function decide(rules: Rule[], req: RequestSummary, state: RuleState, options: RenderOptions = {}): RuleDecision {
  const rule = selectRule(rules, req, state);
  if (!rule) return { kind: 'none' };
  state.consume(rule);
  if (rule.respond.close) return { kind: 'close', rule };
  return { kind: 'respond', rule, response: renderResponse(rule, req, state, options) };
}

export function parseRulesFile(text: string): RulesFile {
  const parsed = JSON.parse(text) as Partial<RulesFile>;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.rules)) {
    throw new Error('rules.json must have schemaVersion 1 and a rules array');
  }
  for (const rule of parsed.rules) {
    if (typeof rule.id !== 'string' || typeof rule.match !== 'object' || typeof rule.respond !== 'object') {
      throw new Error(`rule ${JSON.stringify(rule).slice(0, 80)} needs id, match and respond`);
    }
  }
  return parsed as RulesFile;
}
