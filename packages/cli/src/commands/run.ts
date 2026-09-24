import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  attributeToNode, classify, detectVolatile, diffCase, inputCounts, maskVolatile, normalizeCall, renderPlan, rewriteWorkflow, runWindows, exitCodeFor, overallStatus,
  type CaptureRecord, type CaseDiff, type Fixture, type N8nWorkflow, type NormalizedCall, type RunTimings,
} from '@flowretest/core';
import { blockRule, buildCredentialStubs, genericSinkRule, serviceRole, serviceRules } from '@flowretest/services';
import { loadConfig, workflowDir } from '../config.ts';
import { SandboxSession } from '../sandbox/session.ts';
import { extractRun, logErrors } from '../sandbox/probe-workflow.ts';
import { imageDigest } from '../sandbox/docker.ts';
import { CLI_VERSION } from '../index.ts';

export interface RunOptions {
  cwd: string;
  workflowId: string;
  newFile: string;
  /** 'recorded' (workflowData of the fixtures), 'published' or a file path. */
  old?: string;
  cases?: string[];
  stabilize?: boolean;
  keep?: boolean;
  log: (line: string) => void;
}

export interface RunResult {
  plan: string;
  status: ReturnType<typeof overallStatus>;
  exitCode: number;
  reportPath: string;
}

interface VersionRun {
  status: string;
  error?: string;
  runData: RunTimings;
  calls: NormalizedCall[];
}

function loadFixtures(dir: string, only?: string[]): Fixture[] {
  const fixturesDir = join(dir, 'fixtures');
  if (!existsSync(fixturesDir)) throw new Error(`no fixtures in ${fixturesDir}; run \`flowretest pull\` first`);
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) as Fixture)
    .filter((f) => !only || only.includes(f.source.executionId))
    .sort((a, b) => a.source.executionId.localeCompare(b.source.executionId, undefined, { numeric: true }));
}

function resolveOld(dir: string, fixtures: Fixture[], choice: string | undefined, log: (l: string) => void): { workflow: N8nWorkflow; label: string } {
  const published = JSON.parse(readFileSync(join(dir, 'workflow.published.json'), 'utf8')) as N8nWorkflow;
  if (choice && choice !== 'recorded' && choice !== 'published') return { workflow: JSON.parse(readFileSync(choice, 'utf8')) as N8nWorkflow, label: choice };
  if (choice === 'published') return { workflow: published, label: `published (${published.versionId ?? '?'})` };
  const versions = new Set(fixtures.map((f) => f.source.workflowVersionId ?? '?'));
  const withData = fixtures.find((f) => f.workflowData);
  if (versions.size === 1 && withData?.workflowData) return { workflow: withData.workflowData, label: `recorded (${[...versions][0]})` };
  log(`fixtures come from ${versions.size} workflow versions; using the published version as old`);
  return { workflow: published, label: `published (${published.versionId ?? '?'})` };
}

export async function runRun(options: RunOptions): Promise<RunResult> {
  const config = loadConfig(options.cwd);
  const dir = workflowDir(options.cwd, options.workflowId);
  const fixtures = loadFixtures(dir, options.cases);
  if (fixtures.length === 0) throw new Error('no fixtures selected');
  const oldSide = resolveOld(dir, fixtures, options.old, options.log);
  const newWorkflow = JSON.parse(readFileSync(options.newFile, 'utf8')) as N8nWorkflow;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(dir, 'runs', stamp);
  mkdirSync(runDir, { recursive: true });
  const n8nImage = `${config.engine.image}:${config.engine.tag}`;
  const session = new SandboxSession({ runDir, n8nImage, proxyImage: config.proxy.image, timezone: config.engine.timezone, extraEnv: config.engine.env, keep: options.keep, log: options.log });

  const diffs: CaseDiff[] = [];
  const callsByCase: Record<string, { old: NormalizedCall[]; new: NormalizedCall[]; volatile: string[] }> = {};
  const onSigint = () => {
    options.log('interrupted, removing the sandbox');
    void session.stop().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSigint);
  let writeNodesTotal = 0;
  let writeNodesCaptured = 0;
  let replayedNodes = 0;
  const unsupported = new Set<string>();
  const stabilize = options.stabilize ?? config.run.stabilize;
  try {
    await session.start({ schemaVersion: 1, rules: [...serviceRules(), genericSinkRule(), blockRule()] });
    mkdirSync(join(session.dirs.work, 'cases'), { recursive: true });
    const prepared: Array<{ caseId: string; version: 'old' | 'new'; id: string; writeNodes: string[]; skipped?: string }> = [];
    const uses = [];
    for (const fixture of fixtures) {
      const caseId = fixture.source.executionId;
      for (const version of ['old', 'new'] as const) {
        const workflow = version === 'old' ? oldSide.workflow : newWorkflow;
        const cls = classify(workflow, { triggerNode: fixture.trigger.node, serviceRole });
        const writeNodes = Object.entries(cls.roles).filter(([, r]) => r === 'write').map(([n]) => n);
        if (cls.unsupportedOnPath.length > 0) {
          prepared.push({ caseId, version, id: '', writeNodes, skipped: `unsupported on path: ${cls.unsupportedOnPath.join(', ')}` });
          for (const u of cls.unsupportedOnPath) unsupported.add(u);
          continue;
        }
        const r = rewriteWorkflow(workflow, fixture, cls.roles, { version, caseId, replayVariant: 'code', executionTimeoutSeconds: config.run.timeoutSeconds });
        session.writeWork(`cases/${caseId}-${version}.json`, JSON.stringify(r.workflow));
        uses.push(...r.credentials);
        if (version === 'new') {
          writeNodesTotal += writeNodes.length;
          replayedNodes += r.replaced.filter((x) => x.kind === 'read').length;
        }
        for (const w of r.warnings) options.log(`  case ${caseId} [${version}]: ${w}`);
        prepared.push({ caseId, version, id: r.id, writeNodes });
      }
    }
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const { stubs, unknownTypes } = buildCredentialStubs(uses, { privateKeyPem: () => pem });
    if (unknownTypes.length) options.log(`warning: no stub template for credential types ${unknownTypes.join(', ')}; empty stubs used`);
    if (stubs.length > 0) {
      const credsPath = session.writeWork('credentials.json', JSON.stringify(stubs));
      const imported = await session.n8n(['import:credentials', `--input=${credsPath}`]);
      if (imported.code !== 0) throw new Error(`import:credentials failed: ${(await session.n8nErrors(3)).join(' | ')}`);
    }
    const wfImport = await session.n8n(['import:workflow', '--separate', '--input=/work/cases/']);
    if (wfImport.code !== 0) throw new Error(`import:workflow failed: ${(await session.n8nErrors(3)).join(' | ')}`);

    const execute = async (p: { caseId: string; id: string }, label: string): Promise<VersionRun> => {
      session.setContext(label, p.caseId);
      const exec = await session.n8n(['execute', `--id=${p.id}`, '--rawOutput'], { consoleLog: true, timeoutMs: (config.run.timeoutSeconds + 60) * 1000 });
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
        error = logErrors(exec.stdout, 2).join(' | ') || `n8n exited with ${exec.code} (pre-execution validation failures are not reported by the CLI yet)`;
      }
      const windows = runWindows(runData);
      const records = session.readCapture().map((l) => JSON.parse(l) as CaptureRecord).filter((r) => r.version === label && r.case === p.caseId);
      const calls = records.map((r) => normalizeCall(r, attributeToNode(r.ts, windows), { ignorePaths: config.normalize.ignore, idSegments: config.normalize.idSegments }));
      options.log(`case ${p.caseId} [${label}] ${status}${error ? ' ' + error : ''}, ${calls.length} call${calls.length === 1 ? '' : 's'}`);
      return { status, error, runData, calls };
    };

    /**
     * All workflows of one pass in a single n8n process. Snapshots carry the run data; captures are
     * attributed to executions by their time window because the proxy context cannot change mid-batch.
     */
    const executeBatch = async (items: Array<{ caseId: string; id: string }>, label: string): Promise<Map<string, VersionRun>> => {
      const results = new Map<string, VersionRun>();
      if (items.length === 0) return results;
      const snapDir = join(session.dirs.out, 'snap');
      rmSync(snapDir, { recursive: true, force: true });
      mkdirSync(snapDir, { recursive: true });
      session.setContext(label, 'batch');
      const be = await session.n8n(['executeBatch', `--ids=${items.map((i) => i.id).join(',')}`, '--concurrency=1', '--output=/out/batch.json', '--snapshot=/out/snap/'], { timeoutMs: (config.run.timeoutSeconds + 30) * 1000 * items.length + 60_000 });
      const summaryPath = join(session.dirs.out, 'batch.json');
      const summary = existsSync(summaryPath) ? (JSON.parse(readFileSync(summaryPath, 'utf8')) as { executions?: Array<{ workflowId: string; executionStatus?: string; error?: string }> }) : { executions: [] };
      const allRecords = session.readCapture().map((l) => JSON.parse(l) as CaptureRecord).filter((r) => r.version === label);
      type Snap = { status?: string; startedAt?: string; stoppedAt?: string; data?: { resultData?: { runData?: RunTimings; error?: { message?: string; node?: { name?: string } } } } };
      const snaps = new Map<string, Snap>();
      for (const item of items) {
        const snapPath = join(snapDir, `${item.id}-snapshot.json`);
        if (existsSync(snapPath)) snaps.set(item.id, JSON.parse(readFileSync(snapPath, 'utf8')) as Snap);
      }
      // Executions in a batch run one after another: a request belongs to the last execution that started before it.
      const starts = [...snaps.entries()].map(([id, s]) => ({ id, start: s.startedAt ? Date.parse(s.startedAt) : 0 })).sort((a, b) => a.start - b.start);
      const owner = (ts: number): string | undefined => {
        let found: string | undefined;
        for (const s of starts) if (s.start <= ts + 5) found = s.id;
        return found;
      };
      for (const item of items) {
        const entry = summary.executions?.find((e) => e.workflowId === item.id);
        const snap = snaps.get(item.id);
        if (!snap) {
          options.log(`case ${item.caseId} [${label}] no snapshot from executeBatch (${entry?.error ?? `exit ${be.code}`}); falling back to execute`);
          results.set(item.id, await execute(item, label));
          continue;
        }
        const runData = snap.data?.resultData?.runData ?? {};
        const err = snap.data?.resultData?.error;
        const error = err ? `${err.node?.name ?? '?'}: ${err.message ?? 'error'}` : entry?.executionStatus === 'error' ? entry.error : undefined;
        const windows = runWindows(runData);
        const calls = allRecords.filter((r) => owner(r.ts) === item.id).map((r) => normalizeCall({ ...r, case: item.caseId }, attributeToNode(r.ts, windows), { ignorePaths: config.normalize.ignore, idSegments: config.normalize.idSegments }));
        const status = snap.status ?? entry?.executionStatus ?? 'unknown';
        options.log(`case ${item.caseId} [${label}] ${status}${error ? ' ' + error : ''}, ${calls.length} call${calls.length === 1 ? '' : 's'}`);
        results.set(item.id, { status, error, runData, calls });
      }
      return results;
    };

    const executor = config.run.executor ?? 'batch';
    const runnable = prepared.filter((p) => !p.skipped);
    const batchRuns = new Map<string, VersionRun>();
    if (executor === 'batch') {
      const olds = runnable.filter((p) => p.version === 'old');
      const news = runnable.filter((p) => p.version === 'new');
      for (const [id, run] of await executeBatch(olds, 'old')) batchRuns.set(`old|${id}`, run);
      for (const [id, run] of await executeBatch(news, 'new')) batchRuns.set(`new|${id}`, run);
      if (stabilize) for (const [id, run] of await executeBatch(olds, 'old2')) batchRuns.set(`old2|${id}`, run);
    }
    const runOf = async (p: { caseId: string; id: string }, label: string): Promise<VersionRun> => batchRuns.get(`${label}|${p.id}`) ?? execute(p, label);

    for (const fixture of fixtures) {
      const caseId = fixture.source.executionId;
      const oldP = prepared.find((p) => p.caseId === caseId && p.version === 'old') as (typeof prepared)[number];
      const newP = prepared.find((p) => p.caseId === caseId && p.version === 'new') as (typeof prepared)[number];
      if (oldP.skipped || newP.skipped) {
        diffs.push({ caseId, status: 'SKIPPED', entries: [], summary: { oldCalls: 0, newCalls: 0, unchanged: 0, changed: 0, added: 0, removed: 0, blocked: 0 }, error: newP.skipped ?? oldP.skipped });
        options.log(`case ${caseId} skipped: ${newP.skipped ?? oldP.skipped}`);
        continue;
      }
      const oldRun = await runOf(oldP, 'old');
      const newRun = await runOf(newP, 'new');
      let oldCalls = oldRun.calls;
      let newCalls = newRun.calls;
      let volatile: string[] = [];
      if (stabilize) {
        const second = await runOf(oldP, 'old2');
        volatile = detectVolatile(oldRun.calls, second.calls);
        if (volatile.length) options.log(`case ${caseId}: volatile fields masked: ${volatile.join(', ')}`);
        oldCalls = maskVolatile(oldCalls, volatile);
        newCalls = maskVolatile(newCalls, volatile);
      }
      callsByCase[caseId] = { old: oldCalls, new: newCalls, volatile };
      const d = diffCase(caseId, oldCalls, newCalls, {
        newError: newRun.error,
        oldError: oldRun.error,
        oldInputCounts: inputCounts(oldRun.runData),
        newInputCounts: inputCounts(newRun.runData),
        oldNodesRun: Object.keys(oldRun.runData),
        newNodesRun: Object.keys(newRun.runData),
      });
      diffs.push(d);
      writeNodesCaptured += newP.writeNodes.filter((n) => newCalls.some((c) => c.node === n && !c.blocked)).length;
    }
    // Errors raised before a workflow started are only in the sandbox database.
    if (diffs.some((d) => d.status === 'ERROR' && (!d.error || /exited with/.test(d.error)))) {
      const hidden = await session.preExecutionErrors();
      for (const d of diffs) {
        const id = prepared.find((p) => p.caseId === d.caseId && p.version === 'new')?.id;
        const message = id ? hidden.get(id) : undefined;
        if (d.status === 'ERROR' && message) d.error = `pre-execution validation: ${message}`;
      }
    }
  } finally {
    process.off('SIGINT', onSigint);
    await session.stop();
  }
  const digest = await imageDigest(n8nImage);
  const plan = renderPlan({
    runner: CLI_VERSION,
    workflowName: newWorkflow.name,
    workflowId: options.workflowId,
    engine: { image: n8nImage, digest },
    oldLabel: oldSide.label,
    newLabel: options.newFile,
    cases: diffs,
    coverage: { writeNodesTotal, writeNodesCaptured, replayedNodes, unsupported: [...unsupported] },
    sealed: true,
  });
  const status = overallStatus(diffs);
  const reportPath = join(runDir, 'report.json');
  writeFileSync(reportPath, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), runner: CLI_VERSION, workflowId: options.workflowId, workflowName: newWorkflow.name, engine: { image: n8nImage, digest }, old: oldSide.label, new: options.newFile, status, cases: diffs, calls: callsByCase, coverage: { writeNodesTotal, writeNodesCaptured, replayedNodes, unsupported: [...unsupported] } }, null, 2));
  writeFileSync(join(runDir, 'plan.txt'), plan + '\n');
  return { plan, status, exitCode: exitCodeFor(status), reportPath };
}
