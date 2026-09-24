#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Command, CommanderError, Option } from 'commander';
import pc from 'picocolors';
import { CLI_VERSION } from './index.ts';
import { runDoctor } from './commands/doctor.ts';
import { pruneSandboxes } from './sandbox/session.ts';
import { defaultProxyImage } from './config.ts';
import { describeError, exitCodeForError } from './errors.ts';
import { byteSize, collect, formatList, idList, positiveInt } from './args.ts';
import { colorPlan } from './color.ts';
import { EXIT_CODES } from '@flowretest/core';

type Formats = Array<'terminal' | 'json' | 'junit' | 'md'>;

const program = new Command();
// Commander exits with 1 on usage errors, and 1 means DIFF; errors are mapped to exit codes at the end of this file.
program.exitOverride();
program
  .name('flowretest')
  .description('Replay real n8n executions against a changed workflow in a sealed sandbox and diff the calls it would send.')
  .version(CLI_VERSION)
  .option('--json', 'machine-readable result on stdout; progress goes to stderr')
  .option('--verbose', 'print every docker command with its duration, and full error stacks')
  .option('--no-color', 'plain text output (also NO_COLOR=1)')
  .option('--cwd <dir>', 'project directory holding .flowretest/ (default: the current directory)')
  .hook('preAction', () => {
    const g = globals();
    if (g.cwd) process.chdir(resolve(g.cwd));
    if (g.verbose) {
      process.env.FLOWRETEST_VERBOSE = '1';
      process.env.FLOWRETEST_DEBUG = '1';
    }
  });

function globals(): { json?: boolean; verbose?: boolean; color: boolean; cwd?: string } {
  return program.opts() as { json?: boolean; verbose?: boolean; color: boolean; cwd?: string };
}

/** Progress lines: stdout normally, stderr with --json so stdout carries only the result. */
function log(line: string): void {
  if (globals().json) console.error(line);
  else console.log(line);
}

/** The result of a command: JSON on stdout with --json, the human text otherwise. */
function emit(json: unknown, text?: string): void {
  if (globals().json) console.log(JSON.stringify(json, null, 2));
  else if (text !== undefined) console.log(text);
}

function plan(text: string): string {
  return colorPlan(text, globals().color !== false && pc.isColorSupported);
}

program
  .command('init')
  .description('Write .flowretest/config.yml and the API key for this project.')
  .requiredOption('--url <url>', 'n8n instance URL')
  .option('--api-key <key>', 'n8n public API key (or FLOWRETEST_API_KEY)')
  .option('--engine <tag>', 'n8n image tag your instance runs; needed unless the instance reports its version anonymously')
  .option('--timezone <tz>', 'sandbox timezone (default: UTC, or the one already in config.yml)')
  .option('--force', 'replace an existing config.yml instead of updating instance, engine and proxy image in it', false)
  .action(async (opts: { url: string; apiKey?: string; engine?: string; timezone?: string; force: boolean }) => {
    const { runInit } = await import('./commands/init.ts');
    await runInit({ cwd: process.cwd(), url: opts.url, apiKey: opts.apiKey, engine: opts.engine, timezone: opts.timezone, force: opts.force, log });
    emit({ ok: true, config: resolve('.flowretest', 'config.yml') });
  });

program
  .command('pull')
  .description('Fetch the published workflow and recent executions as fixtures.')
  .requiredOption('--workflow <id>', 'workflow id on the instance')
  .option('--last <n>', 'number of successful executions to keep', positiveInt, 10)
  .option('--since <date>', 'only executions started after this ISO date')
  .option('--max-size <size>', 'skip fixtures larger than this, e.g. 5mb or 5242880', byteSize, 5 * 1024 * 1024)
  .option('--include-errors', 'also pull failed executions', false)
  .action(async (opts: { workflow: string; last: number; since?: string; maxSize: number; includeErrors: boolean }) => {
    const { runPull } = await import('./commands/pull.ts');
    const out = await runPull({ cwd: process.cwd(), workflowId: opts.workflow, last: opts.last, since: opts.since, maxSizeBytes: opts.maxSize, includeErrors: opts.includeErrors, log });
    emit({ dir: out.dir, fixtures: out.fixtures, skipped: out.skipped });
  });

program
  .command('scan')
  .description('Support table and static findings for a workflow version, plus the structural diff against the old one.')
  .option('--workflow <id>', 'workflow id (as pulled) for the old version and the trigger')
  .option('--new <file>', 'new workflow JSON')
  .option('--old <file>', 'old workflow JSON (default: the published one after pull)')
  .action(async (opts: { workflow?: string; new?: string; old?: string }) => {
    const { runScan } = await import('./commands/scan.ts');
    const out = runScan({ cwd: process.cwd(), workflowId: opts.workflow, newFile: opts.new, oldFile: opts.old, json: globals().json, log: globals().json ? (l) => console.log(l) : log });
    process.exit(out.exitCode);
  });

program
  .command('diff')
  .description('Re-render a saved run, against the old version or against the accepted baselines.')
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .option('--run <stamp>', 'run directory name (default: latest)')
  .addOption(new Option('--against <what>', 'compare with the old version or with the accepted baselines').choices(['old', 'baseline']).default('old'))
  .option('--format <list>', 'comma-separated: terminal, json (printed), junit, md (written into the run directory; *.baseline.* against baselines)', formatList, ['terminal'])
  .action(async (opts: { workflow: string; run?: string; against: string; format: Formats }) => {
    const { runDiff } = await import('./commands/diff.ts');
    const json = globals().json || opts.format.includes('json');
    const out = runDiff({ cwd: process.cwd(), workflowId: opts.workflow, run: opts.run, against: opts.against as 'old' | 'baseline', json, formats: opts.format, log: (l) => (json ? console.log(l) : console.log(plan(l))) });
    process.exit(out.exitCode);
  });

program
  .command('accept')
  .description("Store the new version's calls of a run as the accepted baseline per case (like jest -u).")
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .option('--run <stamp>', 'run directory name (default: latest)')
  .option('--cases <ids>', 'comma-separated case ids to accept', idList)
  .option('--message <text>', 'why this change is intended')
  .option('--force', 'accept without a stability check', false)
  .action(async (opts: { workflow: string; run?: string; cases?: string[]; message?: string; force: boolean }) => {
    const { runAccept } = await import('./commands/accept.ts');
    const written = runAccept({ cwd: process.cwd(), workflowId: opts.workflow, run: opts.run, cases: opts.cases, message: opts.message, force: opts.force, log });
    emit({ written }, `${written.length} baseline${written.length === 1 ? '' : 's'} written`);
    // Nothing accepted (unstable or unchecked cases) must not look like success in a script; 3 is "blocked".
    if (written.length === 0) process.exit(3);
  });

/** Output of run and upgrade-check: the report itself with --json, the coloured plan otherwise. */
async function emitRun(result: { plan: string; reportPath: string; runDir: string; exitCode: number }, upload?: { workflowId: string; url?: string }): Promise<never> {
  if (globals().json) console.log(readFileSync(result.reportPath, 'utf8'));
  else {
    console.log('\n' + plan(result.plan));
    console.log(`\nreport: ${result.reportPath}`);
  }
  let code = result.exitCode;
  if (upload) {
    const { runUpload } = await import('./commands/upload.ts');
    try {
      await runUpload({ cwd: process.cwd(), workflowId: upload.workflowId, run: basename(result.runDir), url: upload.url, log: (line) => console.error(line) });
    } catch (e) {
      // A failed upload must not hide a DIFF or an ERROR; it only turns a PASS into an environment failure.
      console.error(describeError(e, EXIT_CODES.ENVIRONMENT));
      if (code === EXIT_CODES.PASS) code = EXIT_CODES.ENVIRONMENT;
    }
    // process.exit() right after fetch aborts Node on Windows (libuv assertion in async.c, exit code 127 instead of
    // the plan's code); letting the event loop drain ends the process with the same code.
    process.exitCode = code;
    return undefined as never;
  }
  process.exit(code);
}

program
  .command('run')
  .description('Replay the fixtures against the old and the new workflow version in a sealed sandbox and print the plan.')
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .requiredOption('--new <file>', 'new workflow JSON')
  .option('--old <choice>', 'recorded | published | <file>', 'recorded')
  .option('--cases <ids>', 'comma-separated execution ids to replay', idList)
  .option('--stabilize', 'run both versions twice and mask volatile fields; required before accept')
  .option('--stub <node=file>', 'answer a node with the items in a JSON or YAML file instead of running or replaying it (repeatable; also .flowretest/<id>/stubs.yml)', collect, [])
  .option('--format <list>', 'comma-separated: terminal, json, junit, md (files land in the run directory)', formatList, ['terminal'])
  .option('--keep', 'keep the sandbox for inspection (see `sandbox export --compose`)', false)
  .option('--upload', 'send the redacted report to the hosted layer (FLOWRETEST_TOKEN; see `upload`)', false)
  .option('--url <url>', 'hosted layer URL for --upload (default: FLOWRETEST_URL or cloud.url in config.yml)')
  .action(async (opts: { workflow: string; new: string; old: string; cases?: string[]; stabilize?: boolean; stub: string[]; format: Formats; keep: boolean; upload: boolean; url?: string }) => {
    const { runRun } = await import('./commands/run.ts');
    await emitRun(await runRun({ cwd: process.cwd(), workflowId: opts.workflow, newFile: opts.new, old: opts.old, cases: opts.cases, stabilize: opts.stabilize, stubs: opts.stub, formats: opts.format, keep: opts.keep, log }), opts.upload ? { workflowId: opts.workflow, url: opts.url } : undefined);
  });

program
  .command('upgrade-check')
  .description('Replay the same workflow on two n8n images and report engine differences.')
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .requiredOption('--engine-old <tag>', 'current image tag, e.g. 2.40.5')
  .requiredOption('--engine-new <tag>', 'candidate image tag, e.g. 3.0.0')
  .option('--old <choice>', 'recorded | published | <file>', 'recorded')
  .option('--cases <ids>', 'comma-separated execution ids to replay', idList)
  .option('--stabilize', 'run both sides twice and mask volatile fields')
  .option('--stub <node=file>', 'answer a node with the items in a JSON or YAML file (repeatable; also .flowretest/<id>/stubs.yml)', collect, [])
  .option('--format <list>', 'comma-separated: terminal, json, junit, md', formatList, ['terminal'])
  .option('--keep', 'keep the sandboxes for inspection', false)
  .option('--upload', 'send the redacted report to the hosted layer (FLOWRETEST_TOKEN; see `upload`)', false)
  .option('--url <url>', 'hosted layer URL for --upload (default: FLOWRETEST_URL or cloud.url in config.yml)')
  .action(async (opts: { workflow: string; engineOld: string; engineNew: string; old: string; cases?: string[]; stabilize?: boolean; stub: string[]; format: Formats; keep: boolean; upload: boolean; url?: string }) => {
    const { runRun } = await import('./commands/run.ts');
    await emitRun(await runRun({ cwd: process.cwd(), workflowId: opts.workflow, old: opts.old, cases: opts.cases, stabilize: opts.stabilize, stubs: opts.stub, formats: opts.format, keep: opts.keep, engineOld: opts.engineOld, engineNew: opts.engineNew, log }), opts.upload ? { workflowId: opts.workflow, url: opts.url } : undefined);
  });

program
  .command('upload')
  .description('Send the redacted report of a run to the hosted layer; the full report and the fixtures stay on this machine.')
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .option('--run <stamp>', 'run directory name (default: latest)')
  .option('--url <url>', 'hosted layer URL (default: FLOWRETEST_URL or cloud.url in config.yml)')
  .action(async (opts: { workflow: string; run?: string; url?: string }) => {
    const { runUpload } = await import('./commands/upload.ts');
    const result = await runUpload({ cwd: process.cwd(), workflowId: opts.workflow, run: opts.run, url: opts.url, log });
    emit(result, result.url);
  });

program
  .command('redact')
  .description('Write redacted copies of the fixtures (names, emails, phones replaced; ids and dates kept).')
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .option('--out <dir>', 'output directory (default: .flowretest/<id>/fixtures-redacted)')
  .option('--keep-fields <names>', 'comma-separated field names never redacted')
  .option('--report [run]', 'redact a run report instead of the fixtures (default: latest run)')
  .action(async (opts: { workflow: string; out?: string; keepFields?: string; report?: string | boolean }) => {
    const { runRedact, runRedactReport } = await import('./commands/redact.ts');
    if (opts.report !== undefined) emit({ report: runRedactReport({ cwd: process.cwd(), workflowId: opts.workflow, run: typeof opts.report === 'string' ? opts.report : undefined, log }) });
    else emit({ fixtures: runRedact({ cwd: process.cwd(), workflowId: opts.workflow, outDir: opts.out, keepFields: opts.keepFields ? idList(opts.keepFields) : undefined, log }) });
  });

program
  .command('doctor')
  .description('Check Docker, pull images and run a sealed-sandbox round trip (proxy capture and leak test).')
  .option('--engine <tag>', 'n8n image tag', '2.40.5')
  .option('--n8n-image <image>', 'n8n image name', 'n8nio/n8n')
  .option('--proxy-image <image>', 'proxy image, the one pinned in proxy.lock.json by default', defaultProxyImage())
  .option('--timezone <tz>', 'sandbox timezone', 'UTC')
  .option('--keep', 'keep the sandbox and the run directory for inspection', false)
  .option('--no-sandbox', 'only check Docker and images')
  .action(async (opts: { engine: string; n8nImage: string; proxyImage: string; timezone: string; keep: boolean; sandbox: boolean }) => {
    const report = await runDoctor({
      n8nImage: `${opts.n8nImage}:${opts.engine}`,
      proxyImage: opts.proxyImage,
      timezone: opts.timezone,
      keep: opts.keep,
      skipSandbox: !opts.sandbox,
      log,
    });
    emit(report, report.ok ? '\nDoctor: all checks passed.' : '\nDoctor: some checks failed.');
    process.exit(report.ok ? 0 : 4);
  });

const spike = program.command('spike', { hidden: true }).description('Feasibility spike experiments (development only).');
spike
  .command('day3')
  .description('Trigger substitution, replay variants, credential stubs, Code node, Respond to Webhook.')
  .option('--engine <tag>', 'n8n image tag', '2.40.5')
  .option('--proxy-image <image>', 'proxy image', 'flowretest-proxy:dev')
  .option('--variant <variant>', 'code, set or both', 'both')
  .option('--out <file>', 'write results JSON here')
  .option('--keep', 'keep the sandbox', false)
  .action(async (opts: { engine: string; proxyImage: string; variant: string; out?: string; keep: boolean }) => {
    const { runSpikeDay3 } = await import('./commands/spike-day3.ts');
    const variants = opts.variant === 'both' ? (['code', 'set'] as const) : ([opts.variant] as Array<'code' | 'set'>);
    const results = await runSpikeDay3({ n8nImage: `n8nio/n8n:${opts.engine}`, proxyImage: opts.proxyImage, variants: [...variants], keep: opts.keep, outFile: opts.out, log });
    log('\nscenario | variant | status | posts | bodies');
    for (const r of results) log(`${r.scenario} | ${r.variant} | ${r.status}${r.error ? ' (' + r.error + ')' : ''} | ${r.posts} | ${JSON.stringify(r.bodies)}`);
  });

spike
  .command('day4')
  .description('App nodes (Slack, HubSpot, Google Sheets) against sink templates with credential stubs; executeBatch timing.')
  .option('--engine <tag>', 'n8n image tag', '2.40.5')
  .option('--proxy-image <image>', 'proxy image', 'flowretest-proxy:dev')
  .option('--explore', 'answer unknown GETs with {} instead of blocking, to discover request sequences', false)
  .option('--out <file>', 'write results JSON here')
  .option('--keep', 'keep the sandbox', false)
  .action(async (opts: { engine: string; proxyImage: string; explore: boolean; out?: string; keep: boolean }) => {
    const { runSpikeDay4 } = await import('./commands/spike-day4.ts');
    await runSpikeDay4({ n8nImage: `n8nio/n8n:${opts.engine}`, proxyImage: opts.proxyImage, explore: opts.explore, keep: opts.keep, outFile: opts.out, log });
  });

spike
  .command('day5')
  .description('Node matrix: Airtable, Notion, OpenAI, Gemini, Postgres, Code fetch/helpers, multipart.')
  .option('--engine <tag>', 'n8n image tag', '2.40.5')
  .option('--proxy-image <image>', 'proxy image', 'flowretest-proxy:dev')
  .option('--out <file>', 'write results JSON here')
  .option('--keep', 'keep the sandbox', false)
  .action(async (opts: { engine: string; proxyImage: string; out?: string; keep: boolean }) => {
    const { runSpikeDay5 } = await import('./commands/spike-day5.ts');
    const results = await runSpikeDay5({ n8nImage: `n8nio/n8n:${opts.engine}`, proxyImage: opts.proxyImage, keep: opts.keep, outFile: opts.out, log });
    const ok = results.filter((r) => r.verdict === 'ok').length;
    log(`\nmatrix: ${ok}/${results.length} as expected`);
  });

spike
  .command('day7')
  .description('Catalogue cases as old and new versions, first real plan (attribution, normalisation, diff).')
  .option('--engine <tag>', 'n8n image tag', '2.40.5')
  .option('--proxy-image <image>', 'proxy image', 'flowretest-proxy:dev')
  .option('--only <ids>', 'comma-separated case id prefixes', idList)
  .option('--out <file>', 'write results JSON here')
  .option('--keep', 'keep the sandbox', false)
  .action(async (opts: { engine: string; proxyImage: string; only?: string[]; out?: string; keep: boolean }) => {
    const { runSpikeDay7 } = await import('./commands/spike-day7.ts');
    const { plan: text } = await runSpikeDay7({ n8nImage: `n8nio/n8n:${opts.engine}`, proxyImage: opts.proxyImage, only: opts.only, keep: opts.keep, outFile: opts.out, log });
    log('\n' + plan(text));
  });

const sandbox = program.command('sandbox').description('Sandbox housekeeping and debugging.');
sandbox
  .command('prune')
  .description('Remove leftover frt-* containers, volumes and networks (running sandboxes are kept unless --force).')
  .option('--force', 'also remove running sandboxes', false)
  .action(async (opts: { force: boolean }) => {
    await pruneSandboxes(log, opts.force);
    emit({ ok: true }, 'prune done');
  });
sandbox
  .command('export')
  .description('Write docker-compose.yml for a sandbox kept with `run --keep`, to open its workflows and executions in the n8n editor.')
  .argument('<dir>', 'sandbox directory printed by `run --keep` (frt-...)')
  .requiredOption('--compose', 'export as a docker-compose file (the only format)')
  .option('--out <file>', 'where to write it (default: <dir>/docker-compose.yml)')
  .action(async (dir: string, opts: { out?: string }) => {
    const { exportCompose } = await import('./sandbox/compose.ts');
    const file = exportCompose(dir, opts.out);
    emit({ compose: file }, `wrote ${file}\nstart it with: docker compose -f "${file}" up, then open http://127.0.0.1:5678`);
  });

try {
  await program.parseAsync(process.argv);
} catch (e) {
  const code = exitCodeForError(e);
  // Commander has already printed its own message for usage errors, help and version.
  if (!(e instanceof CommanderError)) console.error(describeError(e, code));
  process.exit(code);
}
