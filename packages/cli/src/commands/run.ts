import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aiReplayWarnings, applyStubs, checkExpectations, engineDifferences, withExpectations, replayInputWarnings, attributeRecord, classify, scanDiff, scanWorkflow, detectVolatile, diffCase, exitCodeFor, inputCounts, maskVolatile, normalizeCall, overallStatus, renderFormat, rewriteWorkflow, runWindows, runsIdentical,
  type CaptureRecord, type CaseDiff, type Fixture, type N8nWorkflow, type NormalizedCall, type PlanFormat, type PlanReport, type RunTimings,
} from '@flowretest/core';
import { blockRule, buildCredentialStubs, genericSinkRule, serviceRole, serviceRules, sheetHeadersFromRecordings } from '@flowretest/services';
import { loadConfig, workflowDir, type Config } from '../config.ts';
import { SandboxSession, type SealReport } from '../sandbox/session.ts';
import { loadExpectations, loadStubs } from '../stubs.ts';
import { extractRun, logErrors } from '../sandbox/probe-workflow.ts';
import { imageDigest } from '../sandbox/docker.ts';
import { CLI_VERSION } from '../index.ts';

export interface RunOptions {
  cwd: string;
  workflowId: string;
  /** New workflow JSON; absent in upgrade mode (same workflow on two engines). */
  newFile?: string;
  /** 'recorded' (workflowData of the fixtures), 'published' or a file path. */
  old?: string;
  cases?: string[];
  stabilize?: boolean;
  /** `--stub "<node>=<file>"` flags; they win over `.flowretest/<workflow>/stubs.yml`. */
  stubs?: string[];
  keep?: boolean;
  formats?: PlanFormat[];
  /** Image tags; default from config for both sides. Different tags mean two sandboxes. */
  engineOld?: string;
  engineNew?: string;
  log: (line: string) => void;
}

export interface RunResult {
  plan: string;
  status: ReturnType<typeof overallStatus>;
  exitCode: number;
  reportPath: string;
  runDir: string;
}

type Side = 'old' | 'new';
type Label = 'old' | 'new' | 'old2' | 'new2';

interface VersionRun {
  status: string;
  error?: string;
  runData: RunTimings;
  calls: NormalizedCall[];
}

interface Prepared {
  caseId: string;
  side: Side;
  id: string;
  writeNodes: string[];
  skipped?: string;
  /** The workflow could not be prepared for this case (e.g. the recorded trigger was renamed); the case is ERROR. */
  failed?: string;
  /** Read nodes replayed from the recording, for the replay-input-mismatch check. */
  replayed?: string[];
  /** Nodes answered by a user stub in this case. */
  stubbed?: string[];
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

class SideRunner {
  readonly session: SandboxSession;
  private readonly config: Config;
  private readonly log: (l: string) => void;

  constructor(session: SandboxSession, config: Config, log: (l: string) => void) {
    this.session = session;
    this.config = config;
    this.log = log;
  }

  private normalizeOptions() {
    return { ignorePaths: this.config.normalize.ignore, idSegments: this.config.normalize.idSegments };
  }

  async execute(p: { caseId: string; id: string }, label: string): Promise<VersionRun> {
    this.session.setContext(label, p.caseId);
    const exec = await this.session.n8n(['execute', `--id=${p.id}`, '--rawOutput'], { consoleLog: true, timeoutMs: (this.config.run.timeoutSeconds + 60) * 1000 });
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
      error = logErrors(exec.stdout, 2).join(' | ') || `n8n exited with ${exec.code}`;
    }
    const windows = runWindows(runData);
    const records = this.session.readCapture().map((l) => JSON.parse(l) as CaptureRecord).filter((r) => r.version === label && r.case === p.caseId);
    const calls = records.map((r) => normalizeCall(r, attributeRecord(r, windows), this.normalizeOptions()));
    this.log(`case ${p.caseId} [${label}] ${status}${error ? ' ' + error : ''}, ${calls.length} call${calls.length === 1 ? '' : 's'}`);
    return { status, error, runData, calls };
  }

  /** All workflows of one label in a single n8n process; captures attributed by execution start order. */
  async executeBatch(items: Array<{ caseId: string; id: string }>, label: string): Promise<Map<string, VersionRun>> {
    const results = new Map<string, VersionRun>();
    if (items.length === 0) return results;
    const snapDir = join(this.session.dirs.out, 'snap');
    rmSync(snapDir, { recursive: true, force: true });
    mkdirSync(snapDir, { recursive: true });
    this.session.setContext(label, 'batch');
    const be = await this.session.n8n(['executeBatch', `--ids=${items.map((i) => i.id).join(',')}`, '--concurrency=1', '--output=/out/batch.json', '--snapshot=/out/snap/'], { timeoutMs: (this.config.run.timeoutSeconds + 30) * 1000 * items.length + 60_000 });
    const summaryPath = join(this.session.dirs.out, 'batch.json');
    const summary = existsSync(summaryPath) ? (JSON.parse(readFileSync(summaryPath, 'utf8')) as { executions?: Array<{ workflowId: string; executionStatus?: string; error?: string }> }) : { executions: [] };
    const allRecords = this.session.readCapture().map((l) => JSON.parse(l) as CaptureRecord).filter((r) => r.version === label);
    type Snap = { status?: string; startedAt?: string; stoppedAt?: string; data?: { resultData?: { runData?: RunTimings; error?: { message?: string; node?: { name?: string } } } } };
    const snaps = new Map<string, Snap>();
    for (const item of items) {
      const snapPath = join(snapDir, `${item.id}-snapshot.json`);
      if (existsSync(snapPath)) snaps.set(item.id, JSON.parse(readFileSync(snapPath, 'utf8')) as Snap);
    }
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
        this.log(`case ${item.caseId} [${label}] no snapshot from executeBatch (${entry?.error ?? `exit ${be.code}`}); falling back to execute`);
        results.set(item.id, await this.execute(item, label));
        continue;
      }
      const runData = snap.data?.resultData?.runData ?? {};
      const err = snap.data?.resultData?.error;
      const error = err ? `${err.node?.name ?? '?'}: ${err.message ?? 'error'}` : entry?.executionStatus === 'error' ? entry.error : undefined;
      const windows = runWindows(runData);
      const calls = allRecords.filter((r) => owner(r.ts) === item.id).map((r) => normalizeCall({ ...r, case: item.caseId }, attributeRecord(r, windows), this.normalizeOptions()));
      const status = snap.status ?? entry?.executionStatus ?? 'unknown';
      this.log(`case ${item.caseId} [${label}] ${status}${error ? ' ' + error : ''}, ${calls.length} call${calls.length === 1 ? '' : 's'}`);
      results.set(item.id, { status, error, runData, calls });
    }
    return results;
  }

  async run(items: Array<{ caseId: string; id: string }>, label: string): Promise<Map<string, VersionRun>> {
    if ((this.config.run.executor ?? 'batch') === 'batch') return this.executeBatch(items, label);
    const out = new Map<string, VersionRun>();
    for (const item of items) out.set(item.id, await this.execute(item, label));
    return out;
  }
}

/** The `sandbox` section of report.json: the seal checks of every sandbox of the run. */
export function sandboxSection(seals: SealReport[]): { sealed: boolean; checks: Array<{ network: string; name: string; ok: boolean; detail: string }> } {
  return { sealed: seals.length > 0 && seals.every((s) => s.sealed), checks: seals.flatMap((s) => s.checks.map((c) => ({ network: s.network, ...c }))) };
}

export async function runRun(options: RunOptions): Promise<RunResult> {
  const config = loadConfig(options.cwd);
  const dir = workflowDir(options.cwd, options.workflowId);
  const fixtures = loadFixtures(dir, options.cases);
  const stubs = loadStubs(options.cwd, options.workflowId, options.stubs);
  const expectations = loadExpectations(options.cwd, options.workflowId);
  if (expectations.length) options.log(`expectations: ${expectations.length} from expectations.yml`);
  const stubItemsByNode = Object.fromEntries(Object.entries(stubs).map(([node, s]) => [node, s.items]));
  for (const [node, s] of Object.entries(stubs)) options.log(`stub: "${node}" answered with ${s.items.length} item${s.items.length === 1 ? '' : 's'} from ${s.source}`);
  if (fixtures.length === 0) throw new Error('no fixtures selected');
  const oldSide = resolveOld(dir, fixtures, options.old, options.log);
  const upgrade = !options.newFile;
  const newWorkflow = options.newFile ? (JSON.parse(readFileSync(options.newFile, 'utf8')) as N8nWorkflow) : oldSide.workflow;
  // The scanner's view of the new version, as `flowretest scan` would print it; stored as `static` in report.json.
  const staticTrigger = (fixtures[0] as Fixture).trigger.node;
  const staticResult = scanWorkflow(newWorkflow, applyStubs(classify(newWorkflow, { triggerNode: staticTrigger, serviceRole }), Object.keys(stubs)));
  const staticScan = { trigger: staticTrigger, findings: staticResult.findings, diff: upgrade ? [] : scanDiff(oldSide.workflow, newWorkflow) };
  const engineOld = options.engineOld ?? config.engine.tag;
  const engineNew = options.engineNew ?? config.engine.tag;
  const imageOld = `${config.engine.image}:${engineOld}`;
  const imageNew = `${config.engine.image}:${engineNew}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(dir, 'runs', stamp);
  mkdirSync(runDir, { recursive: true });
  const stabilize = options.stabilize ?? config.run.stabilize;
  const formats = options.formats ?? ['terminal'];

  // Bind mounts must come from a short host path: Docker Desktop on Windows returns EIO for
  // directories deeper than roughly 180 characters, so the sandbox lives in the OS temp dir and
  // only reports stay under .flowretest/.
  const sandboxDirs: string[] = [];
  const sessionFor = (side: Side): SandboxSession => {
    const sandboxDir = mkdtempSync(join(tmpdir(), 'frt-'));
    sandboxDirs.push(sandboxDir);
    return new SandboxSession({ runDir: sandboxDir, n8nImage: side === 'old' ? imageOld : imageNew, proxyImage: config.proxy.image, timezone: config.engine.timezone, extraEnv: config.engine.env, keep: options.keep, log: options.log });
  };
  const sessions: Record<Side, SandboxSession> = imageOld === imageNew ? (() => { const s = sessionFor('old'); return { old: s, new: s }; })() : { old: sessionFor('old'), new: sessionFor('new') };
  const distinctSessions = [...new Set(Object.values(sessions))];
  // The temp dirs hold rewritten workflows with fixture data and the captured requests: they go on every exit path,
  // including Ctrl+C and a cancelled CI job (SIGTERM), before the process ends.
  let cleaning: Promise<void> | undefined;
  const cleanup = (): Promise<void> =>
    (cleaning ??= (async () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      for (const s of distinctSessions) await s.stop().catch((e: unknown) => options.log(`warning: sandbox cleanup failed: ${e instanceof Error ? e.message : String(e)}`));
      if (options.keep) options.log(`sandbox files kept in ${sandboxDirs.join(', ')}`);
      else for (const d of sandboxDirs) rmSync(d, { recursive: true, force: true });
    })());
  const onSignal = (signal: NodeJS.Signals) => {
    options.log(`${signal === 'SIGINT' ? 'interrupted' : 'terminated'}, removing the sandbox`);
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const diffs: CaseDiff[] = [];
  const seals: SealReport[] = [];
  const callsByCase: Record<string, { old: NormalizedCall[]; new: NormalizedCall[]; volatile: string[]; stable?: boolean }> = {};
  let writeNodesTotal = 0;
  let writeNodesCaptured = 0;
  let replayedNodes = 0;
  const unsupported = new Set<string>();
  const stubbedNodes = new Set<string>();
  const prepared: Prepared[] = [];
  try {
    const sheetHeaders = sheetHeadersFromRecordings(fixtures.flatMap((f) => Object.values(f.nodes)));
    if (sheetHeaders) options.log(`sheet header row from the recordings: ${sheetHeaders.join(', ')}`);
    for (const s of distinctSessions) await s.start({ schemaVersion: 1, rules: [...serviceRules({ sheetHeaders }), genericSinkRule(), blockRule()] });
    // Checked before any workflow runs: an unsealed sandbox could send the draft's writes to real services.
    for (const s of distinctSessions) seals.push(await s.verifySeal());
    const failed = seals.flatMap((seal) => seal.checks.filter((c) => !c.ok).map((c) => `${seal.network} ${c.name}: ${c.detail}`));
    if (failed.length) throw new Error(`the sandbox is not sealed, nothing was run (${failed.join('; ')})`);
    const uses: Record<Side, Array<{ type: string; id?: string; name?: string; node: string }>> = { old: [], new: [] };
    for (const fixture of fixtures) {
      const caseId = fixture.source.executionId;
      for (const side of ['old', 'new'] as const) {
        const workflow = side === 'old' ? oldSide.workflow : newWorkflow;
        const cls = applyStubs(classify(workflow, { triggerNode: fixture.trigger.node, serviceRole }), Object.keys(stubs));
        const writeNodes = Object.entries(cls.roles).filter(([, r]) => r === 'write').map(([n]) => n);
        if (cls.unsupportedOnPath.length > 0) {
          prepared.push({ caseId, side, id: '', writeNodes, skipped: `unsupported on path: ${cls.unsupportedOnPath.join(', ')}; answer ${cls.unsupportedOnPath.length === 1 ? 'it' : 'them'} with --stub "<node>=<file.json>" or stubs.yml` });
          for (const u of cls.unsupportedOnPath) unsupported.add(u);
          continue;
        }
        let r: ReturnType<typeof rewriteWorkflow>;
        try {
          r = rewriteWorkflow(workflow, fixture, cls.roles, { version: side, caseId, replayVariant: 'code', executionTimeoutSeconds: config.run.timeoutSeconds, stubs: stubItemsByNode });
        } catch (e) {
          // One case that cannot be prepared (a renamed trigger, a broken recording) must not abort the others.
          const message = e instanceof Error ? e.message : String(e);
          prepared.push({ caseId, side, id: '', writeNodes, failed: `${side} version: ${message}` });
          options.log(`  case ${caseId} [${side}]: cannot prepare the workflow: ${message}`);
          continue;
        }
        mkdirSync(join(sessions[side].dirs.work, `cases-${side}`), { recursive: true });
        sessions[side].writeWork(`cases-${side}/${caseId}.json`, JSON.stringify(r.workflow));
        uses[side].push(...r.credentials);
        if (side === 'new') {
          writeNodesTotal += writeNodes.length;
          replayedNodes += r.replaced.filter((x) => x.kind === 'read').length;
        }
        for (const w of r.warnings) options.log(`  case ${caseId} [${side}]: ${w}`);
        const stubbed = r.replaced.filter((x) => x.kind === 'stub').map((x) => x.node);
        if (side === 'new') for (const n of stubbed) stubbedNodes.add(n);
        prepared.push({ caseId, side, id: r.id, writeNodes, replayed: r.replaced.filter((x) => x.kind === 'read').map((x) => x.node), stubbed });
      }
    }
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    for (const s of distinctSessions) {
      const sides = (Object.keys(sessions) as Side[]).filter((side) => sessions[side] === s);
      const { stubs, unknownTypes } = buildCredentialStubs(sides.flatMap((side) => uses[side]), { privateKeyPem: () => pem });
      if (unknownTypes.length) options.log(`warning: no stub template for credential types ${unknownTypes.join(', ')}; empty stubs used`);
      if (stubs.length > 0) {
        const credsPath = s.writeWork('credentials.json', JSON.stringify(stubs));
        const imported = await s.n8n(['import:credentials', `--input=${credsPath}`]);
        if (imported.code !== 0) throw new Error(`import:credentials failed: ${(await s.n8nErrors(3)).join(' | ')}`);
      }
      for (const side of sides) {
        if (!prepared.some((p) => p.side === side && !p.skipped && !p.failed)) continue;
        const wfImport = await s.n8n(['import:workflow', '--separate', `--input=/work/cases-${side}/`]);
        if (wfImport.code !== 0) throw new Error(`import:workflow (${side}) failed: ${(await s.n8nErrors(3)).join(' | ')}`);
      }
    }

    const runners: Record<Side, SideRunner> = { old: new SideRunner(sessions.old, config, options.log), new: new SideRunner(sessions.new, config, options.log) };
    const runnable = (side: Side) => prepared.filter((p) => p.side === side && !p.skipped && !p.failed);
    const results = new Map<string, VersionRun>();
    const labels: Array<[Label, Side]> = stabilize ? [['old', 'old'], ['new', 'new'], ['old2', 'old'], ['new2', 'new']] : [['old', 'old'], ['new', 'new']];
    for (const [label, side] of labels) for (const [id, run] of await runners[side].run(runnable(side), label)) results.set(`${label}|${id}`, run);

    for (const fixture of fixtures) {
      const caseId = fixture.source.executionId;
      const oldP = prepared.find((p) => p.caseId === caseId && p.side === 'old') as Prepared;
      const newP = prepared.find((p) => p.caseId === caseId && p.side === 'new') as Prepared;
      if (oldP.skipped || newP.skipped) {
        diffs.push({ caseId, status: 'SKIPPED', entries: [], summary: { oldCalls: 0, newCalls: 0, unchanged: 0, changed: 0, added: 0, removed: 0, blocked: 0 }, error: newP.skipped ?? oldP.skipped });
        options.log(`case ${caseId} skipped: ${newP.skipped ?? oldP.skipped}`);
        continue;
      }
      if (oldP.failed || newP.failed) {
        const error = [oldP.failed, newP.failed].filter(Boolean).join('; ');
        diffs.push({ caseId, status: 'ERROR', entries: [], summary: { oldCalls: 0, newCalls: 0, unchanged: 0, changed: 0, added: 0, removed: 0, blocked: 0 }, error });
        continue;
      }
      const oldRun = results.get(`old|${oldP.id}`) as VersionRun;
      const newRun = results.get(`new|${newP.id}`) as VersionRun;
      let oldCalls = oldRun.calls;
      let newCalls = newRun.calls;
      let volatile: string[] = [];
      let stable: boolean | undefined;
      if (stabilize) {
        const old2 = results.get(`old2|${oldP.id}`) as VersionRun;
        const new2 = results.get(`new2|${newP.id}`) as VersionRun;
        volatile = [...new Set([...detectVolatile(oldRun.calls, old2.calls), ...detectVolatile(newRun.calls, new2.calls)])].sort();
        if (volatile.length) options.log(`case ${caseId}: volatile fields masked: ${volatile.join(', ')}`);
        oldCalls = maskVolatile(oldCalls, volatile);
        newCalls = maskVolatile(newCalls, volatile);
        stable = runsIdentical(newCalls, maskVolatile(new2.calls, volatile));
        if (!stable) options.log(`case ${caseId}: the new version is not stable across two runs even after masking; accept will refuse it`);
      }
      callsByCase[caseId] = { old: oldCalls, new: newCalls, volatile, stable };
      const d = diffCase(caseId, oldCalls, newCalls, {
        newError: newRun.error,
        oldError: oldRun.error,
        oldInputCounts: inputCounts(oldRun.runData),
        newInputCounts: inputCounts(newRun.runData),
        oldNodesRun: Object.keys(oldRun.runData),
        newNodesRun: Object.keys(newRun.runData),
      });
      const warnings = [...aiReplayWarnings(oldSide.workflow, newWorkflow), ...replayInputWarnings(fixture, newP.replayed ?? [], inputCounts(newRun.runData)),
        ...[...new Set([...(oldP.stubbed ?? []), ...(newP.stubbed ?? [])])].map((n) => `stub: "${n}" answered from ${stubs[n]?.source ?? 'a stub'}; its real calls are not made and not in the plan`),
      ];
      if (warnings.length) d.warnings = warnings;
      if (upgrade) d.engineDifferences = engineDifferences(oldRun.runData, newRun.runData);
      diffs.push(withExpectations(d, checkExpectations(expectations, caseId, newCalls)));
      writeNodesCaptured += newP.writeNodes.filter((n) => newCalls.some((c) => c.node === n && !c.blocked)).length;
    }
    if (diffs.some((d) => d.status === 'ERROR' && (!d.error || /exited with/.test(d.error)))) {
      const hidden = await sessions.new.preExecutionErrors();
      for (const d of diffs) {
        const id = prepared.find((p) => p.caseId === d.caseId && p.side === 'new')?.id;
        const message = id ? hidden.get(id) : undefined;
        if (d.status === 'ERROR' && message) d.error = `pre-execution validation: ${message}`;
      }
    }
  } finally {
    await cleanup();
  }

  const digestOld = await imageDigest(imageOld);
  const digestNew = imageOld === imageNew ? digestOld : await imageDigest(imageNew);
  const report: PlanReport = {
    runner: CLI_VERSION,
    workflowName: newWorkflow.name,
    workflowId: options.workflowId,
    engine: { image: imageOld === imageNew ? imageNew : `${imageOld} -> ${imageNew}`, digest: digestNew },
    oldLabel: upgrade ? `${oldSide.label} on ${engineOld}` : oldSide.label,
    newLabel: upgrade ? `same workflow on ${engineNew}` : (options.newFile as string),
    cases: diffs,
    coverage: { writeNodesTotal, writeNodesCaptured, replayedNodes, unsupported: [...unsupported].filter((n) => !stubbedNodes.has(n)), ...(stubbedNodes.size ? { stubbed: [...stubbedNodes] } : {}) },
    sealed: seals.length > 0 && seals.every((s) => s.sealed),
    static: staticScan,
    ...(upgrade ? { upgrade: { engineOld, engineNew } } : {}),
  };
  const status = overallStatus(diffs);
  const reportPath = join(runDir, 'report.json');
  writeFileSync(reportPath, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), runner: CLI_VERSION, mode: upgrade ? 'upgrade' : 'change', workflowId: options.workflowId, workflowName: newWorkflow.name, engine: report.engine, engines: { old: imageOld, new: imageNew, digestOld, digestNew }, versions: { old: oldSide.workflow.versionId, new: newWorkflow.versionId }, old: report.oldLabel, new: report.newLabel, status, cases: diffs, calls: callsByCase, coverage: report.coverage, sandbox: sandboxSection(seals), static: staticScan }, null, 2));
  const plan = renderFormat(report, 'terminal');
  writeFileSync(join(runDir, 'plan.txt'), plan + '\n');
  if (formats.includes('junit')) writeFileSync(join(runDir, 'junit.xml'), renderFormat(report, 'junit'));
  if (formats.includes('md')) writeFileSync(join(runDir, 'plan.md'), renderFormat(report, 'md') + '\n');
  return { plan: formats.includes('json') && !formats.includes('terminal') ? renderFormat(report, 'json') : plan, status, exitCode: exitCodeFor(status), reportPath, runDir };
}
