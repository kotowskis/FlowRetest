import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerAvailable, imagePresent, imageDigest, dockerOk } from '../sandbox/docker.ts';
import { SandboxSession } from '../sandbox/session.ts';
import { buildProbeRules, buildProbeWorkflow, extractRun, parseWorkflowList, PROBE_WORKFLOW_ID, PROBE_WORKFLOW_NAME } from '../sandbox/probe-workflow.ts';
import { N8N_LOG_FILE } from '../sandbox/env.ts';

export interface DoctorOptions {
  n8nImage: string;
  proxyImage: string;
  timezone: string;
  keep?: boolean;
  skipSandbox?: boolean;
  log: (line: string) => void;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  durationMs?: number;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

/** n8n writes errors to its log file in the sandbox, so stderr alone is usually empty. */
async function failureDetail(session: SandboxSession, result: { code: number; stdout: string; stderr: string }): Promise<string> {
  const errors = await session.n8nErrors(3);
  const parts = [`exit ${result.code}`];
  if (errors.length > 0) parts.push(`log: ${errors.join(' | ')}`);
  const stderr = result.stderr.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
  if (stderr) parts.push(`stderr: ${stderr}`);
  return parts.join('; ');
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const started = Date.now();
  const value = await fn();
  return { value, durationMs: Date.now() - started };
}

/** Environment checks plus a real sandbox round trip: proxy capture and leak test. */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const push = (check: DoctorCheck) => {
    checks.push(check);
    options.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}${check.durationMs !== undefined ? ` (${check.durationMs} ms)` : ''}`);
  };

  const daemon = await dockerAvailable();
  push({ name: 'docker daemon', ok: daemon.ok, detail: daemon.detail });
  if (!daemon.ok) return { ok: false, checks };

  for (const image of [options.n8nImage, options.proxyImage]) {
    if (await imagePresent(image)) {
      push({ name: `image ${image}`, ok: true, detail: (await imageDigest(image)) ?? 'present (local build, no digest)' });
      continue;
    }
    try {
      const pull = await timed(() => dockerOk(['pull', image], { timeoutMs: 600_000 }));
      push({ name: `image ${image}`, ok: true, detail: `pulled, ${(await imageDigest(image)) ?? 'no digest'}`, durationMs: pull.durationMs });
    } catch (err) {
      push({ name: `image ${image}`, ok: false, detail: err instanceof Error ? err.message : String(err) });
      return { ok: false, checks };
    }
  }
  if (options.skipSandbox) return { ok: checks.every((c) => c.ok), checks };

  const runDir = mkdtempSync(join(tmpdir(), 'flowretest-doctor-'));
  const session = new SandboxSession({
    runDir,
    n8nImage: options.n8nImage,
    proxyImage: options.proxyImage,
    timezone: options.timezone,
    logLevel: 'debug',
    keep: options.keep,
    log: options.log,
  });
  try {
    const start = await timed(() => session.start(buildProbeRules()));
    push({ name: 'sandbox start', ok: true, detail: `network ${session.network}, proxy ${session.proxyName}`, durationMs: start.durationMs });

    // Leak test: a plain client without proxy settings must not reach the internet.
    const leak = await timed(() => session.exec('wget', ['-T', '5', '-t', '1', '-qO-', 'https://example.com/'], { withProxy: false, timeoutMs: 30_000 }));
    push({
      name: 'leak test (wget without proxy must fail)',
      ok: leak.value.code !== 0,
      detail: leak.value.code !== 0 ? `blocked (exit ${leak.value.code})` : 'REACHED THE INTERNET, sandbox is not sealed',
      durationMs: leak.durationMs,
    });

    // Import and execute the probe workflow through the entrypoint (CA + proxy env).
    const workflowPath = session.writeWork('probe.json', JSON.stringify(buildProbeWorkflow()));
    const imported = await timed(() => session.n8n(['import:workflow', `--input=${workflowPath}`]));
    push({
      name: 'n8n import:workflow',
      ok: imported.value.code === 0,
      detail: imported.value.code === 0 ? 'imported' : await failureDetail(session, imported.value),
      durationMs: imported.durationMs,
    });
    if (imported.value.code !== 0) return { ok: false, checks };

    const listed = await session.n8n(['list:workflow'], { consoleLog: true });
    const probe = parseWorkflowList(listed.stdout).find((w) => w.name === PROBE_WORKFLOW_NAME);
    push({
      name: 'n8n list:workflow keeps the imported id',
      ok: probe !== undefined && probe.id === PROBE_WORKFLOW_ID,
      detail: probe ? `probe id ${probe.id}` : `probe not found in: ${listed.stdout.trim().slice(0, 200)}`,
    });
    if (!probe) return { ok: false, checks };

    session.setContext('doctor', 'probe');
    const executed = await timed(() => session.n8n(['execute', `--id=${probe.id}`, '--rawOutput'], { consoleLog: true }));
    let probeOutput: unknown;
    let executeDetail = '';
    if (executed.value.code === 0) {
      try {
        const run = extractRun(executed.value.stdout) as { data?: { resultData?: { runData?: Record<string, Array<{ data?: { main?: Array<Array<{ json?: unknown }>> } }>>; error?: { message?: string } } } };
        const probeRun = run.data?.resultData?.runData?.Probe?.[0];
        probeOutput = probeRun?.data?.main?.[0]?.[0]?.json;
        executeDetail = run.data?.resultData?.error ? `workflow error: ${run.data.resultData.error.message}` : `Probe output ${JSON.stringify(probeOutput)}`;
      } catch (err) {
        executeDetail = `could not parse --rawOutput: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      executeDetail = await failureDetail(session, executed.value);
    }
    const probeOk = typeof probeOutput === 'object' && probeOutput !== null && (probeOutput as { probe?: string }).probe === 'ok';
    push({ name: 'n8n execute through proxy', ok: probeOk, detail: executeDetail, durationMs: executed.durationMs });

    const captured = session.readCapture().map((l) => JSON.parse(l) as { host: string; path: string; rule: { id: string }; version: string; case: string });
    const hit = captured.find((c) => c.host === 'example.com' && c.path === '/flowretest-probe');
    push({
      name: 'proxy capture',
      ok: hit !== undefined && hit.rule.id === 'probe' && hit.version === 'doctor' && hit.case === 'probe',
      detail: hit ? `captured ${hit.host}${hit.path} via rule ${hit.rule.id} (${captured.length} lines)` : `no capture line for the probe (${captured.length} lines)`,
    });

    const log = await session.exec('cat', [N8N_LOG_FILE], { timeoutMs: 30_000 });
    const proxyLine = /Installing global HTTP proxy agents/i.test(log.stdout);
    push({
      name: 'n8n log: global proxy agents',
      ok: proxyLine,
      detail: proxyLine ? 'found "Installing global HTTP proxy agents"' : `line not found (log ${log.stdout.length} chars, exit ${log.code})`,
    });
  } catch (err) {
    push({ name: 'sandbox', ok: false, detail: err instanceof Error ? err.message : String(err) });
  } finally {
    await session.stop();
    if (!options.keep) session.cleanupRunDir();
    else options.log(`run directory kept: ${runDir}`);
  }
  return { ok: checks.every((c) => c.ok), checks };
}
