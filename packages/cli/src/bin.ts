#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { CLI_VERSION } from './index.ts';
import { runDoctor } from './commands/doctor.ts';
import { pruneSandboxes } from './sandbox/session.ts';
import { defaultProxyImage } from './config.ts';
import { describeError, exitCodeForError } from './errors.ts';

const program = new Command();
// Commander exits with 1 on usage errors, and 1 means DIFF; errors are mapped to exit codes at the end of this file.
program.exitOverride();
program
  .name('flowretest')
  .description('Replay real n8n executions against a changed workflow in a sealed sandbox and diff the calls it would send.')
  .version(CLI_VERSION);

program
  .command('init')
  .description('Write .flowretest/config.yml and the API key for this project.')
  .requiredOption('--url <url>', 'n8n instance URL')
  .option('--api-key <key>', 'n8n public API key (or FLOWRETEST_API_KEY)')
  .option('--engine <tag>', 'n8n image tag; detected from the instance when omitted')
  .option('--timezone <tz>', 'sandbox timezone', 'UTC')
  .action(async (opts: { url: string; apiKey?: string; engine?: string; timezone: string }) => {
    const { runInit } = await import('./commands/init.ts');
    await runInit({ cwd: process.cwd(), url: opts.url, apiKey: opts.apiKey, engine: opts.engine, timezone: opts.timezone, log: (l) => console.log(l) });
  });

program
  .command('pull')
  .description('Fetch the published workflow and recent executions as fixtures.')
  .requiredOption('--workflow <id>', 'workflow id on the instance')
  .option('--last <n>', 'number of successful executions to keep', '10')
  .option('--since <date>', 'only executions started after this ISO date')
  .option('--max-size <bytes>', 'skip fixtures larger than this', String(5 * 1024 * 1024))
  .option('--include-errors', 'also pull failed executions', false)
  .action(async (opts: { workflow: string; last: string; since?: string; maxSize: string; includeErrors: boolean }) => {
    const { runPull } = await import('./commands/pull.ts');
    await runPull({ cwd: process.cwd(), workflowId: opts.workflow, last: Number(opts.last), since: opts.since, maxSizeBytes: Number(opts.maxSize), includeErrors: opts.includeErrors, log: (l) => console.log(l) });
  });

program
  .command('scan')
  .description('Support table and static findings for a workflow version, plus the structural diff against the old one.')
  .option('--workflow <id>', 'workflow id (as pulled) for the old version and the trigger')
  .option('--new <file>', 'new workflow JSON')
  .option('--old <file>', 'old workflow JSON (default: the published one after pull)')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { workflow?: string; new?: string; old?: string; json: boolean }) => {
    const { runScan } = await import('./commands/scan.ts');
    const out = runScan({ cwd: process.cwd(), workflowId: opts.workflow, newFile: opts.new, oldFile: opts.old, json: opts.json, log: (l) => console.log(l) });
    process.exit(out.exitCode);
  });

program
  .command('diff')
  .description('Re-render a saved run, against the old version or against the accepted baselines.')
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .option('--run <stamp>', 'run directory name (default: latest)')
  .option('--against <what>', 'old | baseline', 'old')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { workflow: string; run?: string; against: string; json: boolean }) => {
    const { runDiff } = await import('./commands/diff.ts');
    const out = runDiff({ cwd: process.cwd(), workflowId: opts.workflow, run: opts.run, against: opts.against === 'baseline' ? 'baseline' : 'old', json: opts.json, log: (l) => console.log(l) });
    process.exit(out.exitCode);
  });

program
  .command('accept')
  .description("Store the new version's calls of a run as the accepted baseline per case (like jest -u).")
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .option('--run <stamp>', 'run directory name (default: latest)')
  .option('--cases <ids>', 'comma-separated case ids to accept')
  .option('--message <text>', 'why this change is intended')
  .option('--force', 'accept without a stability check', false)
  .action(async (opts: { workflow: string; run?: string; cases?: string; message?: string; force: boolean }) => {
    const { runAccept } = await import('./commands/accept.ts');
    const written = runAccept({ cwd: process.cwd(), workflowId: opts.workflow, run: opts.run, cases: opts.cases?.split(','), message: opts.message, force: opts.force, log: (l) => console.log(l) });
    console.log(`${written.length} baseline${written.length === 1 ? '' : 's'} written`);
  });

program
  .command('run')
  .description('Replay the fixtures against the old and the new workflow version in a sealed sandbox and print the plan.')
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .requiredOption('--new <file>', 'new workflow JSON')
  .option('--old <choice>', 'recorded | published | <file>', 'recorded')
  .option('--cases <ids>', 'comma-separated execution ids to replay')
  .option('--stabilize', 'run both versions twice and mask volatile fields; required before accept')
  .option('--format <list>', 'comma-separated: terminal, json, junit, md (files land in the run directory)', 'terminal')
  .option('--keep', 'keep the sandbox for inspection', false)
  .action(async (opts: { workflow: string; new: string; old: string; cases?: string; stabilize?: boolean; format: string; keep: boolean }) => {
    const { runRun } = await import('./commands/run.ts');
    const formats = opts.format.split(',').map((f) => f.trim()) as Array<'terminal' | 'json' | 'junit' | 'md'>;
    const result = await runRun({ cwd: process.cwd(), workflowId: opts.workflow, newFile: opts.new, old: opts.old, cases: opts.cases?.split(','), stabilize: opts.stabilize, formats, keep: opts.keep, log: (l) => console.log(l) });
    console.log('\n' + result.plan);
    console.log(`\nreport: ${result.reportPath}`);
    process.exit(result.exitCode);
  });

program
  .command('upgrade-check')
  .description('Replay the same workflow on two n8n images and report engine differences.')
  .requiredOption('--workflow <id>', 'workflow id (as pulled)')
  .requiredOption('--engine-old <tag>', 'current image tag, e.g. 2.40.5')
  .requiredOption('--engine-new <tag>', 'candidate image tag, e.g. 3.0.0')
  .option('--old <choice>', 'recorded | published | <file>', 'recorded')
  .option('--cases <ids>', 'comma-separated execution ids to replay')
  .option('--stabilize', 'run both sides twice and mask volatile fields')
  .option('--format <list>', 'comma-separated: terminal, json, junit, md', 'terminal')
  .option('--keep', 'keep the sandboxes for inspection', false)
  .action(async (opts: { workflow: string; engineOld: string; engineNew: string; old: string; cases?: string; stabilize?: boolean; format: string; keep: boolean }) => {
    const { runRun } = await import('./commands/run.ts');
    const formats = opts.format.split(',').map((f) => f.trim()) as Array<'terminal' | 'json' | 'junit' | 'md'>;
    const result = await runRun({ cwd: process.cwd(), workflowId: opts.workflow, old: opts.old, cases: opts.cases?.split(','), stabilize: opts.stabilize, formats, keep: opts.keep, engineOld: opts.engineOld, engineNew: opts.engineNew, log: (l) => console.log(l) });
    console.log('\n' + result.plan);
    console.log(`\nreport: ${result.reportPath}`);
    process.exit(result.exitCode);
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
    if (opts.report !== undefined) runRedactReport({ cwd: process.cwd(), workflowId: opts.workflow, run: typeof opts.report === 'string' ? opts.report : undefined, log: (l) => console.log(l) });
    else runRedact({ cwd: process.cwd(), workflowId: opts.workflow, outDir: opts.out, keepFields: opts.keepFields?.split(','), log: (l) => console.log(l) });
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
      log: (line) => console.log(line),
    });
    console.log(report.ok ? '\nDoctor: all checks passed.' : '\nDoctor: some checks failed.');
    process.exit(report.ok ? 0 : 4);
  });

const spike = program.command('spike').description('Feasibility spike experiments (development only).');
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
    const results = await runSpikeDay3({ n8nImage: `n8nio/n8n:${opts.engine}`, proxyImage: opts.proxyImage, variants: [...variants], keep: opts.keep, outFile: opts.out, log: (line) => console.log(line) });
    console.log('\nscenario | variant | status | posts | bodies');
    for (const r of results) console.log(`${r.scenario} | ${r.variant} | ${r.status}${r.error ? ' (' + r.error + ')' : ''} | ${r.posts} | ${JSON.stringify(r.bodies)}`);
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
    await runSpikeDay4({ n8nImage: `n8nio/n8n:${opts.engine}`, proxyImage: opts.proxyImage, explore: opts.explore, keep: opts.keep, outFile: opts.out, log: (line) => console.log(line) });
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
    const results = await runSpikeDay5({ n8nImage: `n8nio/n8n:${opts.engine}`, proxyImage: opts.proxyImage, keep: opts.keep, outFile: opts.out, log: (line) => console.log(line) });
    const ok = results.filter((r) => r.verdict === 'ok').length;
    console.log(`\nmatrix: ${ok}/${results.length} as expected`);
  });

spike
  .command('day7')
  .description('Catalogue cases as old and new versions, first real plan (attribution, normalisation, diff).')
  .option('--engine <tag>', 'n8n image tag', '2.40.5')
  .option('--proxy-image <image>', 'proxy image', 'flowretest-proxy:dev')
  .option('--only <ids>', 'comma-separated case id prefixes')
  .option('--out <file>', 'write results JSON here')
  .option('--keep', 'keep the sandbox', false)
  .action(async (opts: { engine: string; proxyImage: string; only?: string; out?: string; keep: boolean }) => {
    const { runSpikeDay7 } = await import('./commands/spike-day7.ts');
    const { plan } = await runSpikeDay7({ n8nImage: `n8nio/n8n:${opts.engine}`, proxyImage: opts.proxyImage, only: opts.only?.split(','), keep: opts.keep, outFile: opts.out, log: (line) => console.log(line) });
    console.log('\n' + plan);
  });

program
  .command('sandbox')
  .description('Sandbox housekeeping.')
  .command('prune')
  .description('Remove leftover frt-* containers, volumes and networks (running sandboxes are kept unless --force).')
  .option('--force', 'also remove running sandboxes', false)
  .action(async (opts: { force: boolean }) => {
    await pruneSandboxes((line) => console.log(line), opts.force);
    console.log('prune done');
  });

try {
  await program.parseAsync(process.argv);
} catch (e) {
  const code = exitCodeForError(e);
  // Commander has already printed its own message for usage errors, help and version.
  if (!(e instanceof CommanderError)) console.error(describeError(e, code));
  process.exit(code);
}
