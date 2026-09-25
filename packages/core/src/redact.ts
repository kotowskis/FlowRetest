import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Fixture, RecordedItem } from './fixture.ts';
import type { PlanReport } from './render.ts';
import type { NormalizedCall, QueryValues } from './normalize.ts';

/** Placeholders written by the normaliser; they carry no customer data and stay readable in a redacted report. */
const PLACEHOLDERS = new Set(['<ts>', '<uuid>', '<epoch>', '<token>', '<volatile>', '<ignored>']);

export interface ShapeOptions {
  /** Secret for the value hash. Without it a short hash of a phone number or a PESEL is reversed by brute force in seconds. */
  salt: string;
}

/**
 * Numbers from a million up become `<digits N>`: a phone number, a PESEL or a card number sent as a JSON number is as
 * personal as the same digits in a string. Amounts and counts below that stay readable.
 */
const LARGE_NUMBER = 1_000_000;

function isLargeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) >= LARGE_NUMBER;
}

/** `<string 12 #a1b2c3d4>`: type, length and a salted hash instead of the value. Booleans and small numbers stay. */
export function shapeOf(value: unknown, options: ShapeOptions = { salt: randomBytes(16).toString('hex') }): unknown {
  if (isLargeNumber(value)) return `<digits ${String(Math.trunc(Math.abs(value))).length}>`;
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (PLACEHOLDERS.has(value)) return value;
    return `<string ${value.length} #${createHmac('sha256', options.salt).update(value).digest('hex').slice(0, 8)}>`;
  }
  if (Array.isArray(value)) return `<array ${value.length}>`;
  if (typeof value === 'object') return `<object ${Object.keys(value as object).length}>`;
  return `<${typeof value}>`;
}

/**
 * Personal data inside free text, keys and path segments: emails, and seven or more digits in a row that may be split
 * by spaces, dashes, dots or brackets (phones, PESEL, card and account numbers). Shapes already written (`<...>`) are
 * matched first and left alone, so scrubbing twice changes nothing.
 */
const PERSONAL_TEXT = /(<[^<>]*>)|([^\s@"'<>/?&=[\]]+@[^\s@"'<>/?&=[\]]+\.[^\s@"'<>/?&=[\].,;:()]+)|(\+?\d(?:[\s().-]?\d){6,})/g;

/** Emails and long digit runs in a text replaced by shapes; the rest of the text stays readable. */
export function scrubPersonal(text: string, options: ShapeOptions): string {
  return text.replace(PERSONAL_TEXT, (m, shape?: string, email?: string) => {
    if (shape !== undefined) return m;
    if (email !== undefined) return String(shapeOf(email, options));
    return `<digits ${m.replace(/\D/g, '').length}>`;
  });
}

/** True when a text still has an email or a long digit run outside shapes. */
export function hasPersonal(text: string): boolean {
  for (const m of text.matchAll(PERSONAL_TEXT)) if (m[1] === undefined) return true;
  return false;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A path segment that may carry a value: whitespace (a name), an email or a long digit run. `{id}` and shapes pass. */
function personalSegment(segment: string): boolean {
  if (segment === '' || /^\{\w+\}$/.test(segment) || SHAPE.test(segment)) return false;
  const decoded = safeDecode(segment);
  return /\s/.test(decoded) || hasPersonal(decoded);
}

/** The path template with every segment that looks like a value (`/customers/Anna%20Kowalska`) replaced by its shape. */
function shapePath(template: string, options: ShapeOptions): string {
  return template
    .split('/')
    .map((s) => (personalSegment(s) ? String(shapeOf(safeDecode(s), options)) : s))
    .join('/');
}

/** Object and query keys stay readable (they are field names) unless the key itself is an email or a number. */
function shapeKey(key: string, options: ShapeOptions): string {
  return hasPersonal(key) ? String(shapeOf(key, options)) : key;
}

function shapeBody(value: unknown, options: ShapeOptions): unknown {
  if (Array.isArray(value)) return value.map((v) => shapeBody(v, options));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[shapeKey(k, options)] = shapeBody(v, options);
    return out;
  }
  return shapeOf(value, options);
}

function shapeCall(call: NormalizedCall, options: ShapeOptions): NormalizedCall {
  const query: QueryValues = {};
  for (const [k, v] of Object.entries(call.query)) query[shapeKey(k, options)] = Array.isArray(v) ? v.map((x) => String(shapeOf(x, options))) : String(shapeOf(v, options));
  const pathTemplate = shapePath(call.pathTemplate, options);
  const node = scrubPersonal(call.node, options);
  return {
    ...call,
    node,
    key: `${node}|${call.method}|${call.host}|${pathTemplate}`,
    body: shapeBody(call.body, options),
    query,
    pathTemplate,
    path: pathTemplate,
    pathValue: pathTemplate,
    // An unsalted hash of a small body (one phone number sent to a known endpoint) is reversed by guessing the body;
    // salted, it still pairs equal bodies inside one report.
    bodyHash: saltedHash(call.bodyHash, options),
    multipart: call.multipart?.map((p) => ({ ...p, sha256: saltedHash(p.sha256, options), filename: p.filename ? String(shapeOf(p.filename, options)) : undefined })),
  };
}

function saltedHash(hash: string, options: ShapeOptions): string {
  return createHmac('sha256', options.salt).update(hash).digest('hex').slice(0, Math.max(hash.length, 16));
}

/** A string that `shapeOf` or the normaliser may leave in a redacted report. */
const SHAPE = /^<(?:string \d+ #[0-9a-f]{8}|array \d+|object \d+|digits \d+|[a-z]+)>$/;

function unshapedLeaves(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    if (!SHAPE.test(value)) out.push(path);
  } else if (isLargeNumber(value)) out.push(path);
  else if (Array.isArray(value)) value.forEach((v, i) => unshapedLeaves(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (hasPersonal(k)) out.push(`${path} key`);
      unshapedLeaves(v, `${path}.${k}`, out);
    }
  }
}

/** The parts of a report the guard reads besides the cases; all optional, so a bare `{cases}` can be checked too. */
export type RedactionCheckInput = Pick<PlanReport, 'cases'> &
  Partial<Pick<PlanReport, 'runner' | 'workflowName' | 'oldLabel' | 'newLabel' | 'coverage' | 'static'>> & { git?: { ref?: string } };

/**
 * Where a report that claims to be redacted still carries values: a string that is not a shape or a number from a
 * million up in a body, a query or a field diff, a key or path segment that is an email or a long digit run, a
 * concrete path, or an email or long digit run in free text (names, labels, errors, warnings). The hosted layer
 * refuses such a report, so a runner bug or a hand-edited file cannot put customer data on our servers. Empty when
 * the report looks like `redactPlanReport` output. Names without such markers cannot be told from node names and
 * pass; `scrubText` and `redactPlanReport` handle the rest.
 */
export function redactionProblems(report: RedactionCheckInput, limit = 20): string[] {
  const problems: string[] = [];
  const text = (where: string, value: string | undefined) => {
    if (value !== undefined && hasPersonal(value)) problems.push(`${where}: email or long number in text`);
  };
  text('workflowName', report.workflowName);
  text('runner', report.runner);
  text('oldLabel', report.oldLabel);
  text('newLabel', report.newLabel);
  text('git.ref', report.git?.ref);
  for (const n of [...(report.coverage?.unsupported ?? []), ...(report.coverage?.stubbed ?? [])]) text('coverage', n);
  for (const f of [...(report.static?.findings ?? []), ...(report.static?.diff ?? [])]) {
    text(`static ${f.rule}`, f.message);
    text(`static ${f.rule} node`, f.node);
  }
  report.cases.forEach((c) => {
    const at = `case ${c.caseId}`;
    text(`${at} id`, c.caseId);
    text(`${at} error`, c.error);
    for (const t of [...(c.warnings ?? []), ...(c.engineDifferences ?? []), ...(c.expectationFailures ?? [])]) text(`${at} message`, t);
    c.entries.forEach((e, i) => {
      const where = `${at} entry ${i + 1}`;
      text(`${where} node`, e.node);
      if (e.pathTemplate.split('/').some(personalSegment)) problems.push(`${where} path: segment with a value`);
      for (const side of ['old', 'new'] as const) {
        const call = e[side];
        if (!call) continue;
        if (call.path !== call.pathTemplate || (call.pathValue !== undefined && call.pathValue !== call.pathTemplate)) problems.push(`${where} ${side}.path: concrete path instead of the template`);
        if (call.pathTemplate.split('/').some(personalSegment)) problems.push(`${where} ${side}.path: segment with a value`);
        text(`${where} ${side}.node`, call.node);
        text(`${where} ${side}.key`, call.key);
        const leaves: string[] = [];
        unshapedLeaves(call.body, `${side}.body`, leaves);
        unshapedLeaves(call.query, `${side}.query`, leaves);
        for (const p of call.multipart ?? []) if (p.filename !== undefined) unshapedLeaves(p.filename, `${side}.multipart.filename`, leaves);
        problems.push(...leaves.map((l) => `${where} ${l}: value is not redacted`));
      }
      e.fieldDiffs.forEach((d) => {
        if (hasPersonal(d.path)) problems.push(`${where} field path: email or long number in the path`);
        for (const side of ['old', 'new'] as const) {
          const v = d[side];
          if ((typeof v === 'string' && !SHAPE.test(v)) || (v !== null && typeof v === 'object') || isLargeNumber(v)) problems.push(`${where} field ${d.path} (${side}): value is not redacted`);
        }
      });
    });
  });
  return problems.slice(0, limit);
}

/**
 * Error text from n8n often quotes the request ("customer anna@firma.pl not found"). Emails, quoted strings and
 * long digit runs become shapes; the rest of the message (node name, error class) stays readable.
 */
export function scrubText(text: string, options: ShapeOptions): string {
  // One pass, so a shape written for one match is never rewritten by another alternative. The second pass catches
  // phone numbers written in groups (+48 600 100 200), which the first leaves as short digit runs.
  const first = text.replace(/([^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+)|"([^"]*)"|'([^']*)'|(\d{4,})/g, (m, email?: string, dq?: string, sq?: string, digits?: string) => {
    if (email !== undefined) return String(shapeOf(email, options));
    if (digits !== undefined) return `<digits ${digits.length}>`;
    const inner = dq ?? sq ?? '';
    return inner === '' ? m : `"${String(shapeOf(inner, options))}"`;
  });
  return scrubPersonal(first, options);
}

/**
 * The report that may leave the customer's machine: field names, paths, counts,
 * flags and shapes of values, never the values themselves. Everything the
 * hosted layer needs to show a plan and a trend is still here. The hash salt is
 * random per call unless given, so equal hashes only mean equal values inside one report.
 */
export function redactPlanReport(report: PlanReport, options: Partial<ShapeOptions> = {}): PlanReport {
  const shape: ShapeOptions = { salt: options.salt ?? randomBytes(16).toString('hex') };
  // Names and labels are written by the agency, not by its customers, but a workflow named after a customer's email
  // or a node named after a phone number happens; those markers go, the rest stays readable.
  const text = (value: string) => scrubPersonal(value, shape);
  const finding = <F extends { message: string; node?: string }>(f: F): F => ({ ...f, message: text(f.message), node: f.node === undefined ? undefined : text(f.node) });
  return {
    ...report,
    workflowName: text(report.workflowName),
    oldLabel: text(report.oldLabel),
    newLabel: text(report.newLabel),
    coverage: { ...report.coverage, unsupported: report.coverage.unsupported.map(text), stubbed: report.coverage.stubbed?.map(text) },
    static: report.static ? { findings: report.static.findings.map(finding), diff: report.static.diff.map(finding) } : undefined,
    cases: report.cases.map((c) => ({
      ...c,
      // Errors come from n8n and may quote customer data; warnings are written by the runner from node names.
      error: c.error === undefined ? undefined : scrubText(c.error, shape),
      warnings: c.warnings?.map(text),
      engineDifferences: c.engineDifferences?.map((d) => scrubText(d, shape)),
      expectationFailures: c.expectationFailures?.map((f) => scrubText(f, shape)),
      entries: c.entries.map((e) => ({
        ...e,
        node: text(e.node),
        pathTemplate: shapePath(e.pathTemplate, shape),
        old: e.old ? shapeCall(e.old, shape) : undefined,
        new: e.new ? shapeCall(e.new, shape) : undefined,
        fieldDiffs: e.fieldDiffs.map((d) => ({ path: text(d.path), old: shapeOf(d.old, shape), new: shapeOf(d.new, shape) })),
      })),
    })),
  };
}

/**
 * Replaces personal-looking values with synthetic ones of the same type and
 * length. The same input value always maps to the same output inside one
 * redaction, so joins between nodes keep working. Field names are kept.
 */
export interface RedactOptions {
  /** Secret salt so redacted values cannot be reversed by dictionary; random when absent. */
  salt?: string;
  /** Field names (last path segment) that are never redacted, e.g. ids the catalogue relies on. */
  keepFields?: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Phone numbers, PESEL, card and account numbers: seven or more digits, bare or with spaces, dashes and brackets. */
const PHONE = /^\+?[\d\s()-]{7,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const URL_LIKE = /^https?:\/\//i;
const NUMERIC = /^-?\d+(\.\d+)?$/;
/** Short codes such as C-1, ORD-2026-17, rec123: identifiers, kept. A mixed-case word with digits (Anna1990) is not a code. */
const CODE = /^(?:[A-Z]{1,6}[-_]?|[a-z]{1,3}[-_]?|[a-z]{1,6}[-_])\d[\w-]{0,15}$/;
const KEEP_KEYS = new Set(['id', 'type', 'typeVersion', 'status', 'mode', 'method', 'operation', 'resource']);
/** Words of a key name that mark personal data; values under them are redacted whatever they look like. */
const PERSONAL_WORDS = new Set([
  'name', 'firstname', 'lastname', 'first', 'last', 'surname', 'fullname', 'email', 'mail', 'phone', 'tel', 'telephone', 'mobile',
  'address', 'street', 'city', 'zip', 'postal', 'postcode', 'pesel', 'nip', 'regon', 'iban', 'card', 'birth', 'birthday', 'birthdate',
  'dob', 'login', 'user', 'username', 'nick', 'nickname', 'password', 'imie', 'nazwisko', 'adres', 'telefon', 'ulica', 'miasto',
]);
const BIRTH_WORDS = new Set(['birth', 'birthday', 'birthdate', 'dob', 'urodzenia']);

function keyWords(key: string | undefined): string[] {
  if (!key) return [];
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export class Redactor {
  private readonly map = new Map<string, string>();
  private readonly salt: string;
  private readonly keep: Set<string>;

  constructor(options: RedactOptions = {}) {
    this.salt = options.salt ?? randomBytes(16).toString('hex');
    this.keep = new Set([...KEEP_KEYS, ...(options.keepFields ?? [])]);
  }

  private token(value: string): number {
    return parseInt(createHash('sha256').update(`${this.salt}:${value}`).digest('hex').slice(0, 8), 16);
  }

  /** Same length and letter case; any letter (Ł, Ż, Cyrillic) becomes an ASCII letter, digits stay digits. */
  private sameLengthWord(value: string, seed: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let out = '';
    let state = seed;
    for (const ch of value) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      if (/\p{Lu}/u.test(ch)) out += (alphabet[state % 26] as string).toUpperCase();
      else if (/\p{L}/u.test(ch)) out += alphabet[state % 26];
      else if (/\d/.test(ch)) out += String(state % 10);
      else out += ch;
    }
    return out;
  }

  private digits(value: string, seed: number): string {
    return value.replace(/\d/g, (d, i: number) => String((seed + i * 7 + Number(d)) % 10));
  }

  /** Local part and domain replaced with the same lengths; the top-level domain stays so the value still reads as an email. */
  private email(value: string, seed: number): string {
    const [local = '', domain = ''] = value.split('@');
    const labels = domain.split('.');
    const tld = labels.pop() ?? '';
    return `${this.sameLengthWord(local, seed)}@${[...labels.map((l, i) => this.sameLengthWord(l, seed + i + 1)), tld].join('.')}`;
  }

  /** Endpoints stay; credentials in the URL are dropped, query values and email-like path segments are redacted. */
  private url(value: string): string {
    try {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      url.pathname = url.pathname.split('/').map((s) => (EMAIL.test(decodeURIComponent(s)) ? encodeURIComponent(this.redactString(decodeURIComponent(s))) : s)).join('/');
      for (const [k, v] of [...url.searchParams.entries()]) url.searchParams.set(k, this.isIdKey(k) ? v : this.sameLengthWord(v, this.token(v)));
      return url.toString();
    } catch {
      return this.sameLengthWord(value, this.token(value));
    }
  }

  private isIdKey(key: string | undefined): boolean {
    return !!key && (this.keep.has(key) || /(^|[_-])id$|Id$|ID$/.test(key));
  }

  private isPersonalKey(key: string | undefined): boolean {
    return keyWords(key).some((w) => PERSONAL_WORDS.has(w));
  }

  redactString(value: string, key?: string): string {
    // Identifiers are what the diff keys on; they are codes, not personal data.
    if (this.isIdKey(key)) return value;
    if (value === '' || UUID.test(value)) return value;
    const personal = this.isPersonalKey(key);
    const birth = keyWords(key).some((w) => BIRTH_WORDS.has(w));
    if (ISO_DATE.test(value) && !birth) return value;
    if (!personal && (CODE.test(value) || (NUMERIC.test(value) && !PHONE.test(value)))) return value;
    const cached = this.map.get(value);
    if (cached) return cached;
    const seed = this.token(value);
    let out: string;
    if (ISO_DATE.test(value) || PHONE.test(value) || NUMERIC.test(value)) out = this.digits(value, seed);
    else if (URL_LIKE.test(value)) out = this.url(value);
    else if (EMAIL.test(value)) out = this.email(value, seed);
    else out = this.sameLengthWord(value, seed);
    this.map.set(value, out);
    return out;
  }

  redactValue(value: unknown, key?: string): unknown {
    if (typeof value === 'string') return this.redactString(value, key);
    // Numbers stay (amounts, counts) unless the field is personal (a phone or PESEL stored as a number).
    if (typeof value === 'number' && Number.isSafeInteger(value) && !this.isIdKey(key) && this.isPersonalKey(key)) {
      const text = String(Math.abs(value));
      const out = this.digits(text, this.token(text)).replace(/^0/, '1');
      return value < 0 ? -Number(out) : Number(out);
    }
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v, key));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = this.redactValue(v, k);
      return out;
    }
    return value;
  }

  /** Binary data (file contents and names) is dropped: the replay never injects it, and it is the hardest part to redact. */
  redactItems(items: RecordedItem[]): RecordedItem[] {
    return items.map(({ binary: _binary, ...item }) => ({ ...item, json: this.redactValue(item.json) }));
  }

  /** Redacts every recorded item in a fixture; workflow JSON and structure stay untouched. */
  redactFixture(fixture: Fixture): Fixture {
    const nodes: Fixture['nodes'] = {};
    for (const [name, node] of Object.entries(fixture.nodes)) {
      nodes[name] = { ...node, runs: node.runs.map((run) => ({ ...run, outputs: run.outputs.map((items) => this.redactItems(items)) })) };
    }
    const out: Fixture = { ...fixture, trigger: { ...fixture.trigger, items: this.redactItems(fixture.trigger.items) }, nodes, redacted: true };
    out.source = { ...fixture.source, instanceHost: fixture.source.instanceHost ? 'redacted.example' : undefined };
    out.sizeBytes = Buffer.byteLength(JSON.stringify(out));
    return out;
  }
}
