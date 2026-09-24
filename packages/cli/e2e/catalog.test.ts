/**
 * End-to-end: the regression catalogue through a real sandbox.
 * Needs Docker and the images; run with `npm run e2e -w packages/cli`.
 * FLOWRETEST_ENGINE selects the n8n tag (default 2.40.5).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSpikeDay7 } from '../src/commands/spike-day7.ts';

const EXPECT: Record<string, { status: string; flags: string[]; changed?: number; removed?: number }> = {
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
};

test('catalogue cases produce the expected plan', { timeout: 20 * 60 * 1000 }, async () => {
  const engine = process.env.FLOWRETEST_ENGINE ?? '2.40.5';
  const { cases } = await runSpikeDay7({ n8nImage: `n8nio/n8n:${engine}`, proxyImage: process.env.FLOWRETEST_PROXY_IMAGE ?? 'flowretest-proxy:dev', log: (l) => console.log(l) });
  assert.equal(cases.length, Object.keys(EXPECT).length);
  for (const c of cases) {
    const e = EXPECT[c.caseId];
    assert.ok(e, `unexpected case ${c.caseId}`);
    assert.equal(c.status, e.status, `${c.caseId} status`);
    const flags = new Set(c.entries.flatMap((x) => x.flags));
    for (const f of e.flags) assert.ok(flags.has(f), `${c.caseId} missing flag ${f}`);
    if (e.changed !== undefined) assert.equal(c.summary.changed, e.changed, `${c.caseId} changed`);
    if (e.removed !== undefined) assert.equal(c.summary.removed, e.removed, `${c.caseId} removed`);
  }
});
