/**
 * Load test of POST /api/runs (plan section 11, week 14). Creates throwaway organizations on the local Supabase,
 * uploads redacted reports the way `flowretest upload` does and prints latency percentiles and status counts per
 * scenario. Deletes what it created at the end.
 *
 *   node scripts/load-upload.ts --app http://127.0.0.1:3101 [--orgs 8] [--duration 30] [--concurrency 10,25,50]
 *                                [--scenarios steady,burst,large,limit,badtoken] [--pid <app pid>] [--out results.json]
 *
 * Needs .env.local (npm run db:env) and a running app; `next start` gives numbers closer to production than
 * `next dev`. The numbers describe one machine: use them to compare changes and to find limits, not as capacity.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { diffCase, normalizeCall, redactPlanReport, type CaptureRecord, type PlanReport } from '@flowretest/core';
import { generateToken } from '../lib/tokens.ts';
import type { Database } from '../lib/database.types.ts';

// ---------------------------------------------------------------------------------------------------------------
// Arguments and environment
// ---------------------------------------------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const envFile = new URL('../.env.local', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1] as string]) process.env[m[1] as string] = m[2];
  }
}

const APP = arg('app', process.env.APP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');
const ORGS = Number(arg('orgs', '8'));
const DURATION_S = Number(arg('duration', '30'));
const CONCURRENCY = arg('concurrency', '10,25,50').split(',').map(Number);
const SCENARIOS = new Set(arg('scenarios', 'steady,burst,large,limit,badtoken').split(','));
const PID = arg('pid', '');
const OUT = arg('out', '');

const db: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------------------------------------------------------
// Reports: `cases` cases with `calls` changed calls of `fields` fields each, redacted like an upload
// ---------------------------------------------------------------------------------------------------------------

function record(version: string, i: number, fields: number, salt: string): CaptureRecord {
  const body: Record<string, unknown> = {};
  for (let f = 0; f < fields; f++) body[`field_${f}`] = f % 3 === 0 ? `${salt}-${version}-${i}-${f}@example.com` : f % 3 === 1 ? f * 17 + i : `value ${version} ${f}`;
  return { ts: 1, version, case: '1', method: 'POST', host: 'crm.example.com', port: 443, path: `/api/contacts/${i}`, query: {}, headers: {}, bodyJson: body, bodyBytes: 1, bodySha256: 'x', rule: { id: 'generic-sink', kind: 'generic-sink' }, response: { status: 200 } };
}

function report(cases: number, calls: number, fields: number): string {
  const salt = randomUUID().slice(0, 8);
  const diffs = Array.from({ length: cases }, (_, c) =>
    diffCase(
      String(c + 1),
      Array.from({ length: calls }, (_, i) => normalizeCall(record('old', i, fields, salt), { node: `Send ${i}`, runIndex: 0 })),
      Array.from({ length: calls }, (_, i) => normalizeCall(record('new', i, fields, salt), { node: `Send ${i}`, runIndex: 0 })),
    ),
  );
  const plan: PlanReport = { runner: '0.3.0', workflowName: `Load ${salt}`, workflowId: `load-${cases}-${calls}`, engine: { image: 'n8nio/n8n:2.40.5' }, oldLabel: 'recorded', newLabel: 'draft.json', cases: diffs, coverage: { writeNodesTotal: calls, writeNodesCaptured: calls, replayedNodes: 0, unsupported: [] }, sealed: true };
  return JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), redacted: true, ...redactPlanReport(plan) });
}

// ---------------------------------------------------------------------------------------------------------------
// Setup and cleanup
// ---------------------------------------------------------------------------------------------------------------

interface Tenant {
  orgId: string;
  token: string;
}

const created: string[] = [];

async function tenant(plan: 'free' | 'agency', label: string): Promise<Tenant> {
  const org = await db.from('organizations').insert({ name: `Load ${label} ${randomUUID().slice(0, 6)}` }).select('id').single();
  if (org.error) throw org.error;
  const orgId = org.data.id;
  created.push(orgId);
  if (plan === 'agency') {
    const b = await db.from('billing_accounts').upsert({ organization_id: orgId, stripe_customer_id: `cus_load_${orgId}`, stripe_subscription_id: `sub_load_${orgId}`, plan: 'agency', status: 'active', billing_interval: 'month', ended_at: null });
    if (b.error) throw b.error;
  }
  const ws = await db.from('workspaces').insert({ organization_id: orgId, name: 'Load' }).select('id').single();
  if (ws.error) throw ws.error;
  const t = generateToken();
  const tok = await db.from('workspace_tokens').insert({ workspace_id: ws.data.id, name: 'load', token_hash: t.hash, token_prefix: t.prefix });
  if (tok.error) throw tok.error;
  return { orgId, token: t.token };
}

async function cleanup(): Promise<void> {
  if (created.length === 0) return;
  // A live subscription blocks deletion (prevent_billed_org_delete); the rows are fake, so end them first.
  await db.from('billing_accounts').update({ status: 'canceled' }).in('organization_id', created);
  const { error } = await db.from('organizations').delete().in('id', created);
  if (error) console.error('cleanup failed:', error.message);
}

// ---------------------------------------------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------------------------------------------

interface Sample {
  ms: number;
  status: number;
}

interface Result {
  scenario: string;
  concurrency: number;
  requests: number;
  seconds: number;
  rps: number;
  bodyKB: number;
  status: Record<string, number>;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  appRssMB?: number;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number);
}

/** Resident memory of the app process in MB (Windows tasklist or Linux /proc), when --pid is given. */
function rssMB(): number | undefined {
  if (!PID) return undefined;
  try {
    if (process.platform === 'win32') {
      const line = execFileSync('tasklist', ['/fo', 'csv', '/nh', '/fi', `PID eq ${PID}`], { encoding: 'utf8' });
      const kb = Number((line.split('","')[4] ?? '').replace(/[^0-9]/g, ''));
      return Math.round(kb / 1024);
    }
    const status = readFileSync(`/proc/${PID}/status`, 'utf8');
    return Math.round(Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024);
  } catch {
    return undefined;
  }
}

async function post(token: string, body: string): Promise<Sample> {
  const start = performance.now();
  try {
    const res = await fetch(`${APP}/api/runs`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
    await res.arrayBuffer();
    return { ms: performance.now() - start, status: res.status };
  } catch {
    return { ms: performance.now() - start, status: 0 };
  }
}

/** `concurrency` workers send requests until `until` says stop; tokens are taken round robin. */
async function drive(scenario: string, concurrency: number, tokens: string[], bodies: string[], until: (sent: number, elapsedMs: number) => boolean): Promise<Result> {
  const samples: Sample[] = [];
  let sent = 0;
  let peak = 0;
  const start = performance.now();
  const sampler = setInterval(() => {
    const m = rssMB();
    if (m && m > peak) peak = m;
  }, 1000);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (!until(sent, performance.now() - start)) {
        const n = sent++;
        samples.push(await post(tokens[n % tokens.length] as string, bodies[n % bodies.length] as string));
      }
    }),
  );
  clearInterval(sampler);
  const seconds = (performance.now() - start) / 1000;
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const status: Record<string, number> = {};
  for (const s of samples) status[s.status] = (status[s.status] ?? 0) + 1;
  const bodyKB = Math.round(bodies.reduce((a, b) => a + Buffer.byteLength(b), 0) / bodies.length / 1024);
  return { scenario, concurrency, requests: samples.length, seconds: Math.round(seconds * 10) / 10, rps: Math.round((samples.length / seconds) * 10) / 10, bodyKB, status, p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99), max: pct(sorted, 100), appRssMB: peak || undefined };
}

function print(r: Result): void {
  const codes = Object.entries(r.status).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`${r.scenario.padEnd(9)} c=${String(r.concurrency).padEnd(3)} n=${String(r.requests).padEnd(5)} ${String(r.rps).padStart(6)} req/s  body ${r.bodyKB} KB  p50 ${r.p50} ms  p95 ${r.p95} ms  p99 ${r.p99} ms  max ${r.max} ms  [${codes}]${r.appRssMB ? `  rss ${r.appRssMB} MB` : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const health = await fetch(`${APP}/login`).catch(() => undefined);
  if (!health?.ok) throw new Error(`app not reachable at ${APP}`);
  const results: Result[] = [];
  const sizes = { small: report(3, 3, 8), medium: report(5, 10, 20), large: report(20, 40, 45) };
  console.log(`report sizes: small ${Math.round(sizes.small.length / 1024)} KB, medium ${Math.round(sizes.medium.length / 1024)} KB, large ${Math.round(sizes.large.length / 1024)} KB`);
  const agencies = await Promise.all(Array.from({ length: ORGS }, (_, i) => tenant('agency', `agency-${i}`)));
  const tokens = agencies.map((t) => t.token);

  // Warm-up: the first requests compile and load modules in the app.
  await drive('warmup', 2, tokens, [sizes.small], (sent) => sent >= 20);

  if (SCENARIOS.has('steady')) {
    for (const c of CONCURRENCY) {
      const r = await drive('steady', c, tokens, [sizes.small, sizes.small, sizes.small, sizes.medium], (_s, ms) => ms >= DURATION_S * 1000);
      results.push(r);
      print(r);
    }
  }

  if (SCENARIOS.has('burst')) {
    // One agency's CI matrix finishing at once: every upload of one organization waits for the previous one on the
    // organization's advisory lock in ingest_run (it keeps the daily count exact).
    const r = await drive('burst', 20, [tokens[0] as string], [sizes.small, sizes.medium], (sent) => sent >= 100);
    results.push(r);
    print(r);
  }

  if (SCENARIOS.has('large')) {
    for (const c of [1, 4, 8]) {
      const r = await drive('large', c, tokens, [sizes.large], (sent) => sent >= c * 5);
      results.push(r);
      print(r);
    }
  }

  if (SCENARIOS.has('limit')) {
    // Free allows 50 uploads in 24 hours; 80 at once must give exactly 50 stored runs, whatever the interleaving.
    const free = await tenant('free', 'free');
    const r = await drive('limit', 40, [free.token], [sizes.small], (sent) => sent >= 80);
    results.push(r);
    print(r);
    const { count } = await db.from('runs').select('id', { count: 'exact', head: true }).eq('workspace_id', (await db.from('workspaces').select('id').eq('organization_id', free.orgId).single()).data!.id);
    console.log(`limit    stored runs: ${count} (expected 50), 201: ${r.status['201'] ?? 0}, 429: ${r.status['429'] ?? 0}`);
    if (count !== 50 || r.status['201'] !== 50 || r.status['429'] !== 30) process.exitCode = 1;
  }

  if (SCENARIOS.has('badtoken')) {
    // Revoked or made-up tokens with a 4 MB body: the server must answer 401 without reading the body.
    const r = await drive('badtoken', 25, [`frt_${'x'.repeat(40)}`], [sizes.large], (sent) => sent >= 200);
    results.push(r);
    print(r);
    if (Object.keys(r.status).some((s) => s !== '401')) process.exitCode = 1;
  }

  if (OUT) writeFileSync(OUT, `${JSON.stringify({ app: APP, at: new Date().toISOString(), node: process.version, platform: process.platform, results }, null, 2)}\n`);
}

try {
  await main();
} finally {
  await cleanup();
}
