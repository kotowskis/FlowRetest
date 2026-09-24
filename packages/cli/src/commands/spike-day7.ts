/**
 * Days 7 and 8 of the spike: catalogue cases run as old and new versions in
 * one sandbox; captures are attributed to nodes by run timings, normalised,
 * diffed and rendered. Cases marked `stabilize` run the old version twice to
 * detect volatile fields; case 01 also demonstrates accept and a baseline diff.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aiReplayWarnings, attributeRecord, attributeToNode, classify, detectVolatile, diffCase, fromBaseline, inputCounts, maskVolatile, normalizeCall, renderPlan, rewriteWorkflow, runWindows, runsIdentical, toBaseline,
  type CaptureRecord, type CaseDiff, type NormalizedCall, type RunTimings,
} from '@flowretest/core';
import { blockRule, buildCredentialStubs, genericSinkRule, serviceRole, serviceRules } from '@flowretest/services';
import { SandboxSession } from '../sandbox/session.ts';
import { extractRun, logErrors } from '../sandbox/probe-workflow.ts';
import { catalogCases } from '../catalog/cases.ts';

export interface SpikeDay7Options {
  n8nImage: string;
  proxyImage: string;
  only?: string[];
  keep?: boolean;
  outFile?: string;
  log: (line: string) => void;
}

interface VersionRun {
  status: string;
  error?: string;
  runData: RunTimings;
  calls: NormalizedCall[];
  durationMs: number;
}

export async function runSpikeDay7(options: SpikeDay7Options): Promise<{ plan: string; cases: CaseDiff[]; notes: string[] }> {
  const runDir = mkdtempSync(join(tmpdir(), 'flowretest-day7-'));
  const session = new SandboxSession({ runDir, n8nImage: options.n8nImage, proxyImage: options.proxyImage, timezone: 'UTC', logLevel: 'info', keep: options.keep, log: options.log });
  const rules = { schemaVersion: 1, rules: [...serviceRules(), genericSinkRule(), blockRule()] };
  const diffs: CaseDiff[] = [];
  const notes: string[] = [];
  let writeNodesTotal = 0;
  let writeNodesCaptured = 0;
  let replayedNodes = 0;
  const unsupported = new Set<string>();
  let sealed = false;
  try {
    await session.start(rules);
    sealed = (await session.verifySeal()).sealed;
    if (!sealed) throw new Error('the sandbox is not sealed, nothing was run');
    mkdirSync(join(session.dirs.work, 'cases'), { recursive: true });
    const selected = catalogCases().filter((c) => !options.only || options.only.some((o) => c.id.startsWith(o)));
    const prepared: Array<{ caseId: string; version: 'old' | 'new'; id: string; writeNodes: string[] }> = [];
    const skippedCases = new Map<string, string>();
    const uses = [];
    for (const c of selected) {
      for (const version of ['old', 'new'] as const) {
        const workflow = version === 'old' ? c.old : c.new;
        const cls = classify(workflow, { triggerNode: c.fixture.trigger.node, serviceRole });
        if (cls.unsupportedOnPath.length > 0) {
          // Same rule as `run`: an unsupported node on the path skips the case instead of executing it.
          skippedCases.set(c.id, `${version}: unsupported on path: ${cls.unsupportedOnPath.join(', ')}`);
          for (const u of cls.unsupportedOnPath) unsupported.add(u);
          continue;
        }
        const r = rewriteWorkflow(workflow, c.fixture, cls.roles, { version, caseId: c.id, replayVariant: 'code', executionTimeoutSeconds: 60 });
        session.writeWork(`cases/${c.id}-${version}.json`, JSON.stringify(r.workflow, null, 2));
        uses.push(...r.credentials);
        const writeNodes = Object.entries(cls.roles).filter(([, role]) => role === 'write').map(([n]) => n);
        if (version === 'new') {
          writeNodesTotal += writeNodes.length;
          replayedNodes += r.replaced.filter((x) => x.kind === 'read').length;
          for (const u of cls.unsupportedOnPath) unsupported.add(u);
        }
        prepared.push({ caseId: c.id, version, id: r.id, writeNodes });
        for (const w of r.warnings) options.log(`  ${c.id} [${version}] warning: ${w}`);
      }
    }
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const { stubs } = buildCredentialStubs(uses, { privateKeyPem: () => pem });
    if (stubs.length > 0) {
      const credsPath = session.writeWork('credentials.json', JSON.stringify(stubs));
      const credImport = await session.n8n(['import:credentials', `--input=${credsPath}`]);
      options.log(`import:credentials exit ${credImport.code}`);
    }
    const wfImport = await session.n8n(['import:workflow', '--separate', '--input=/work/cases/']);
    options.log(`import:workflow exit ${wfImport.code}${wfImport.code !== 0 ? ' ' + (await session.n8nErrors(3)).join(' | ') : ''}`);
    if (wfImport.code !== 0) throw new Error('import failed');

    const executeVersion = async (p: { caseId: string; version: 'old' | 'new'; id: string; writeNodes: string[] }, label: string): Promise<VersionRun> => {
      session.setContext(label, p.caseId);
      const started = Date.now();
      const exec = await session.n8n(['execute', `--id=${p.id}`, '--rawOutput'], { consoleLog: true, timeoutMs: 180_000 });
      const durationMs = Date.now() - started;
      let status = `exit ${exec.code}`;
      let error: string | undefined;
      let runData: RunTimings = {};
      if (exec.code === 0) {
        try {
          const run = extractRun(exec.stdout) as { status?: string; data?: { resultData?: { runData?: RunTimings; error?: { message?: string; node?: { name?: string } } } } };
          status = run.status ?? 'unknown';
          runData = run.data?.resultData?.runData ?? {};
          const err = run.data?.resultData?.error;
          if (err) error = `${err.node?.name ?? '?'}: ${err.message ?? 'error'}`;
        } catch (e) {
          status = 'unparsed';
          error = e instanceof Error ? e.message : String(e);
        }
      } else {
        error = logErrors(exec.stdout, 2).join(' | ') || `exit ${exec.code}`;
      }
      const windows = runWindows(runData);
      const records = session.readCapture().map((l) => JSON.parse(l) as CaptureRecord).filter((r) => r.version === label && r.case === p.caseId);
      const calls = records.map((r) => normalizeCall(r, attributeRecord(r, windows)));
      if (process.env.FRT_DEBUG_TIMING) {
        for (const w of windows) options.log(`    window ${w.node}#${w.runIndex} ${w.start}..${w.end} (${w.end - w.start} ms)`);
        for (const r of records) options.log(`    capture ${r.ts} ${r.method} ${r.path} -> ${attributeRecord(r, windows).node}`);
      }
      options.log(`${p.caseId} [${label}] ${status}${error ? ' error=' + error : ''} calls=${calls.length} unattributed=${calls.filter((c) => c.node === '?').length} (${durationMs} ms)`);
      return { status, error, runData, calls, durationMs };
    };

    const runs = new Map<string, VersionRun>();
    for (const p of prepared) if (!skippedCases.has(p.caseId)) runs.set(`${p.caseId}|${p.version}`, await executeVersion(p, p.version));

    for (const c of selected) {
      const skipReason = skippedCases.get(c.id);
      if (skipReason) {
        diffs.push({ caseId: c.id, status: 'SKIPPED', entries: [], summary: { oldCalls: 0, newCalls: 0, unchanged: 0, changed: 0, added: 0, removed: 0, blocked: 0 }, error: skipReason });
        options.log(`${c.id}: SKIPPED (${skipReason}) expected: ${c.expect}`);
        continue;
      }
      const oldRun = runs.get(`${c.id}|old`) as VersionRun;
      const newRun = runs.get(`${c.id}|new`) as VersionRun;
      let oldCalls = oldRun.calls;
      let newCalls = newRun.calls;
      let volatilePaths: string[] = [];
      if (c.stabilize) {
        const p = prepared.find((x) => x.caseId === c.id && x.version === 'old');
        const second = await executeVersion(p as (typeof prepared)[number], 'old2');
        volatilePaths = detectVolatile(oldRun.calls, second.calls);
        const unstable = diffCase(c.id, oldRun.calls, newRun.calls);
        notes.push(`${c.id}: without stabilisation ${unstable.status}; volatile paths ${JSON.stringify(volatilePaths)}`);
        oldCalls = maskVolatile(oldCalls, volatilePaths);
        newCalls = maskVolatile(newCalls, volatilePaths);
        notes.push(`${c.id}: old runs identical after masking: ${runsIdentical(maskVolatile(oldRun.calls, volatilePaths), maskVolatile(second.calls, volatilePaths))}`);
      }
      const d = diffCase(c.id, oldCalls, newCalls, {
        newError: newRun.error,
        oldError: oldRun.error,
        oldInputCounts: inputCounts(oldRun.runData),
        newInputCounts: inputCounts(newRun.runData),
        oldNodesRun: Object.keys(oldRun.runData),
        newNodesRun: Object.keys(newRun.runData),
      });
      const ai = aiReplayWarnings(c.old, c.new);
      if (ai.length) d.warnings = ai;
      diffs.push(d);
      options.log(`${c.id}: ${d.status} (${JSON.stringify(d.summary)}) expected: ${c.expect}`);
      const p = prepared.find((x) => x.caseId === c.id && x.version === 'new') as (typeof prepared)[number];
      writeNodesCaptured += p.writeNodes.filter((n) => newCalls.some((x) => x.node === n && !x.blocked)).length;

      if (c.id.startsWith('01')) {
        const baseline = toBaseline(c.id, newCalls, { acceptedAt: new Date().toISOString(), runnerVersion: '0.0.0-spike', volatilePaths });
        const again = diffCase(c.id, fromBaseline(baseline), newCalls);
        notes.push(`${c.id}: accept wrote ${baseline.calls.length} calls; new version against its own baseline: ${again.status}; old version against that baseline: ${diffCase(c.id, fromBaseline(baseline), oldCalls).status}`);
      }
    }
  } finally {
    await session.stop();
  }
  const plan = renderPlan({
    runner: '0.0.0-spike',
    workflowName: 'catalog',
    engine: { image: options.n8nImage },
    oldLabel: 'catalog old',
    newLabel: 'catalog new',
    cases: diffs,
    coverage: { writeNodesTotal, writeNodesCaptured, replayedNodes, unsupported: [...unsupported] },
    sealed,
  });
  for (const n of notes) options.log(`note: ${n}`);
  if (options.outFile) {
    mkdirSync(join(options.outFile, '..'), { recursive: true });
    writeFileSync(options.outFile, JSON.stringify({ plan, cases: diffs, notes }, null, 2));
  }
  return { plan, cases: diffs, notes };
}
