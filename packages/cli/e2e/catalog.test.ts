/**
 * End-to-end: the regression catalogue through the production path, `flowretest run` (executeBatch, exclusive
 * capture attribution, report files, exit codes), one temporary project per case. Case 01 also goes through
 * `accept` and `diff --against baseline`.
 * Needs Docker and the images; run with `npm run e2e -w packages/cli`.
 * FLOWRETEST_ENGINE selects the n8n tag (default 2.40.5), FLOWRETEST_PROXY_IMAGE the proxy image
 * (default flowretest-proxy:dev), FLOWRETEST_E2E_CONCURRENCY how many cases run at once (default 3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES, type CaseDiff } from '@flowretest/core';
import { catalogCases, type CatalogCase } from '../src/catalog/cases.ts';
import { defaultConfig, saveConfig } from '../src/config.ts';
import { runRun } from '../src/commands/run.ts';
import { runAccept } from '../src/commands/accept.ts';
import { runDiff } from '../src/commands/diff.ts';

const EXPECT: Record<string, { status: string; flags: string[]; changed?: number; removed?: number; warnings?: number }> = {
  '01-empty-id-after-field-rename': { status: 'DIFF', flags: ['empty-value'], changed: 2 },
  '02-loop-sends-first-item-n-times': { status: 'DIFF', flags: ['duplicate-bodies'], changed: 1 },
  '03-merge-by-position-truncates': { status: 'DIFF', flags: ['count-changed'], removed: 1 },
  '04-execute-once-toggled': { status: 'DIFF', flags: ['count-changed', 'count-per-item-changed'], removed: 1 },
  '05-code-filter-drops-everything': { status: 'DIFF', flags: ['node-not-executed'], removed: 2 },
  '06-random-nonce-unchanged': { status: 'PASS', flags: [] },
  // each endpoint keeps one call, but with the other customer: paired as changed, not added plus removed
  '07-if-branches-swapped': { status: 'DIFF', flags: [], changed: 2 },
  // Limit shrinks the input of the write node, so calls per input item stay 1:1; only the total count changes
  '08-limit-before-write': { status: 'DIFF', flags: ['count-changed'], removed: 1 },
  '09-date-format-changed': { status: 'DIFF', flags: [], changed: 2 },
  '10-http-method-changed': { status: 'DIFF', flags: [] },
  '11-body-field-renamed': { status: 'DIFF', flags: ['missing-field'], changed: 2 },
  '12-query-param-dropped': { status: 'DIFF', flags: ['missing-field'], changed: 2 },
  '13-ai-prompt-changed-replayed': { status: 'PASS', flags: [], warnings: 1 },
  '14-postgres-select-replayed-insert-skipped': { status: 'SKIPPED', flags: [] },
  '15-hubspot-property-empty-after-rename': { status: 'DIFF', flags: [], changed: 2 },
};

/** Exit code of a run whose only case has this status. */
const EXIT_FOR: Record<string, number> = { PASS: EXIT_CODES.PASS, DIFF: EXIT_CODES.DIFF, ERROR: EXIT_CODES.ERROR, BLOCKED: EXIT_CODES.BLOCKED, SKIPPED: EXIT_CODES.BLOCKED };

const engine = process.env.FLOWRETEST_ENGINE ?? '2.40.5';
const proxyImage = process.env.FLOWRETEST_PROXY_IMAGE ?? 'flowretest-proxy:dev';
const concurrency = Math.max(1, Number(process.env.FLOWRETEST_E2E_CONCURRENCY ?? 3));
const WORKFLOW_ID = 'catalog1';

/** A project directory as `init` and `pull` leave it: config, published workflow, one fixture; plus the new version. */
function project(c: CatalogCase): { cwd: string; newFile: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'frt-e2e-'));
  const config = defaultConfig('http://localhost:5678', engine, 'UTC');
  config.proxy.image = proxyImage;
  saveConfig(cwd, config);
  const dir = join(cwd, '.flowretest', WORKFLOW_ID);
  mkdirSync(join(dir, 'fixtures'), { recursive: true });
  writeFileSync(join(dir, 'workflow.published.json'), JSON.stringify(c.old));
  writeFileSync(join(dir, 'fixtures', `${c.fixture.source.executionId}.json`), JSON.stringify(c.fixture));
  const newFile = join(cwd, 'new.json');
  writeFileSync(newFile, JSON.stringify(c.new));
  return { cwd, newFile };
}

interface Outcome {
  c: CatalogCase;
  cwd: string;
  diff: CaseDiff;
  exitCode: number;
  logs: string[];
  report: { cases: CaseDiff[]; sandbox?: { sealed: boolean }; coverage: { stubbed?: string[] } };
  plan: string;
}

async function runCase(c: CatalogCase, stubs: Record<string, unknown[]> = {}): Promise<Outcome> {
  const { cwd, newFile } = project(c);
  const logs: string[] = [];
  const stubFlags = Object.entries(stubs).map(([node, items]) => {
    const file = join(cwd, `stub-${Object.keys(stubs).indexOf(node)}.json`);
    writeFileSync(file, JSON.stringify(items));
    return `${node}=${file}`;
  });
  // Case 01 is accepted afterwards, and accept needs a run that checked stability.
  const stabilize = c.stabilize === true || c.id.startsWith('01-');
  const result = await runRun({ cwd, workflowId: WORKFLOW_ID, newFile, old: 'published', stabilize, stubs: stubFlags, formats: ['terminal', 'junit', 'md'], log: (l) => logs.push(l) });
  const report = JSON.parse(readFileSync(result.reportPath, 'utf8')) as Outcome['report'];
  assert.ok(existsSync(join(result.runDir, 'junit.xml')), `${c.id}: junit.xml`);
  assert.ok(existsSync(join(result.runDir, 'plan.md')), `${c.id}: plan.md`);
  return { c, cwd, diff: report.cases[0] as CaseDiff, exitCode: result.exitCode, logs, report, plan: result.plan };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

test('catalogue cases produce the expected plan through `flowretest run`', { timeout: 40 * 60 * 1000 }, async () => {
  const cases = catalogCases();
  assert.equal(cases.length, Object.keys(EXPECT).length);
  const outcomes = await pool(cases, concurrency, runCase);
  try {
    for (const outcome of outcomes) {
      const { c, diff, exitCode, logs } = outcome;
      const e = EXPECT[c.id];
      assert.ok(e, `unexpected case ${c.id}`);
      const context = `${c.id}\n${logs.join('\n')}`;
      console.log(`${c.id}: ${diff.status} ${JSON.stringify(diff.summary)}${diff.error ? ` ${diff.error}` : ''}`);
      assert.equal(diff.status, e.status, `${context}\nstatus`);
      // Every run checks the seal before executing anything and records it.
      assert.equal(outcome.report.sandbox?.sealed, true, `${c.id} sandbox seal`);
      assert.match(outcome.plan, /sandbox sealed \(checked before the run\)/);
      assert.equal(exitCode, EXIT_FOR[e.status], `${c.id} exit code`);
      const flags = new Set(diff.entries.flatMap((x) => x.flags));
      for (const f of e.flags) assert.ok(flags.has(f), `${c.id} missing flag ${f}`);
      if (e.changed !== undefined) assert.equal(diff.summary.changed, e.changed, `${c.id} changed`);
      if (e.removed !== undefined) assert.equal(diff.summary.removed, e.removed, `${c.id} removed`);
      if (e.warnings !== undefined) assert.equal((diff.warnings ?? []).length, e.warnings, `${c.id} warnings ${JSON.stringify(diff.warnings)}`);
    }

    // accept -> diff against baseline: the new version against its own baseline passes.
    const first = outcomes.find((o) => o.c.id.startsWith('01-')) as Outcome;
    const written = runAccept({ cwd: first.cwd, workflowId: WORKFLOW_ID, message: 'e2e', log: () => {} });
    assert.equal(written.length, 1, 'case 01 accepted');
    const againstBaseline = runDiff({ cwd: first.cwd, workflowId: WORKFLOW_ID, against: 'baseline', log: () => {} });
    assert.equal(againstBaseline.cases[0]?.status, 'PASS');
    assert.equal(againstBaseline.exitCode, EXIT_CODES.PASS);

    // Case 14 is skipped for its new Postgres insert "Audit"; with a stub for it the case runs and passes.
    const postgres = cases.find((c) => c.id.startsWith('14-')) as CatalogCase;
    const stubbed = await runCase(postgres, { Audit: [{ id: 1 }, { id: 2 }] });
    outcomes.push(stubbed);
    assert.equal(stubbed.diff.status, 'PASS', stubbed.logs.join('\n'));
    assert.equal(stubbed.exitCode, EXIT_CODES.PASS);
    assert.ok((stubbed.diff.warnings ?? []).some((w) => w.startsWith('stub: "Audit"')), JSON.stringify(stubbed.diff.warnings));
    assert.deepEqual(stubbed.report.coverage.stubbed, ['Audit']);
    assert.equal(stubbed.diff.summary.newCalls, 2);
  } finally {
    for (const o of outcomes) if (o) rmSync(o.cwd, { recursive: true, force: true });
  }
});
