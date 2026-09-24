import { createHash } from 'node:crypto';
import type { Fixture, RecordedItem } from './fixture.ts';

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
const PHONE = /^\+?[\d\s()-]{7,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const URL_LIKE = /^https?:\/\//i;
const NUMERIC = /^-?\d+(\.\d+)?$/;
/** Short codes such as C-1, ORD-2026-17, rec123: identifiers, kept as they are. */
const CODE = /^[A-Za-z]{1,6}[-_]?\d[\w-]{0,15}$/;
const KEEP_KEYS = new Set(['id', 'type', 'typeVersion', 'status', 'mode', 'method', 'operation', 'resource']);

export class Redactor {
  private readonly map = new Map<string, string>();
  private readonly salt: string;
  private readonly keep: Set<string>;
  private counter = 0;

  constructor(options: RedactOptions = {}) {
    this.salt = options.salt ?? createHash('sha256').update(String(Math.random())).digest('hex');
    this.keep = new Set([...KEEP_KEYS, ...(options.keepFields ?? [])]);
  }

  private token(value: string): number {
    return parseInt(createHash('sha256').update(`${this.salt}:${value}`).digest('hex').slice(0, 8), 16);
  }

  private sameLengthWord(value: string, seed: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let out = '';
    let state = seed;
    for (const ch of value) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      if (/[A-Z]/.test(ch)) out += (alphabet[state % 26] as string).toUpperCase();
      else if (/[a-z]/.test(ch)) out += alphabet[state % 26];
      else if (/\d/.test(ch)) out += String(state % 10);
      else out += ch;
    }
    return out;
  }

  redactString(value: string, key?: string): string {
    // Identifiers are what the diff keys on; they are codes, not personal data.
    if (key && (this.keep.has(key) || /(^|[_-])id$|Id$|ID$/.test(key))) return value;
    if (value === '' || ISO_DATE.test(value) || UUID.test(value) || NUMERIC.test(value) || CODE.test(value)) return value;
    const cached = this.map.get(value);
    if (cached) return cached;
    const seed = this.token(value);
    let out: string;
    if (EMAIL.test(value)) {
      this.counter += 1;
      out = `user${this.counter}@example.com`;
    } else if (PHONE.test(value)) {
      out = value.replace(/\d/g, (d, i) => String((seed + i + Number(d)) % 10));
    } else if (URL_LIKE.test(value)) {
      out = value; // endpoints are configuration, not personal data
    } else {
      out = this.sameLengthWord(value, seed);
    }
    this.map.set(value, out);
    return out;
  }

  redactValue(value: unknown, key?: string): unknown {
    if (typeof value === 'string') return this.redactString(value, key);
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v, key));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = this.redactValue(v, k);
      return out;
    }
    return value;
  }

  redactItems(items: RecordedItem[]): RecordedItem[] {
    return items.map((item) => ({ ...item, json: this.redactValue(item.json) }));
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
