import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, saveConfig } from '../src/config.ts';
import { runDiff } from '../src/commands/diff.ts';

test('diff --against baseline reports a case without a baseline as ERROR, not with its status against the old version', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'frt-diff-'));
  try {
    saveConfig(cwd, defaultConfig('http://localhost:5678', '2.40.5', 'UTC'));
    const runDir = join(cwd, '.flowretest', 'w1', 'runs', '20260924-100000');
    mkdirSync(runDir, { recursive: true });
    const summary = { oldCalls: 0, newCalls: 0, unchanged: 0, changed: 0, added: 0, removed: 0, blocked: 0 };
    const report = {
      schemaVersion: 1,
      generatedAt: '2026-09-24T10:00:00Z',
      runner: '0.3.0',
      workflowId: 'w1',
      workflowName: 'Lead intake',
      engine: { image: 'n8nio/n8n:2.40.5' },
      old: 'recorded',
      new: 'draft.json',
      status: 'PASS',
      cases: [
        { caseId: '1', status: 'PASS', entries: [], summary },
        { caseId: '2', status: 'SKIPPED', entries: [], summary, error: 'unsupported on path: Postgres' },
      ],
      calls: { '1': { old: [], new: [], volatile: [] } },
      coverage: { writeNodesTotal: 0, writeNodesCaptured: 0, replayedNodes: 0, unsupported: [] },
    };
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report));
    const out = runDiff({ cwd, workflowId: 'w1', against: 'baseline', log: () => {} });
    assert.equal(out.cases[0]?.status, 'ERROR');
    assert.match(out.cases[0]?.error ?? '', /no baseline for case 1/);
    assert.equal(out.cases[1]?.status, 'SKIPPED');
    assert.equal(out.exitCode, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
