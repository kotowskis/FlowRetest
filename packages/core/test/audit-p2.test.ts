/** P2 items from the audit of weeks 1 to 8 (docs/audyt-2026-09-24.md). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.ts';
import { expressionSafeJson, rewriteWorkflow } from '../src/rewrite.ts';
import { fixtureFromExecution, replayInputWarnings, type Fixture } from '../src/fixture.ts';
import { scanWorkflow } from '../src/scan.ts';
import { xmlEscape } from '../src/render-formats.ts';
import type { N8nWorkflow } from '../src/n8n.ts';

test('set replay: no {{ or }} survives, three closing braces included, and string data keeps its braces', () => {
  const value = [{ z: { y: { x: 1 } }, s: 'Hi {{name}} }}}' }];
  const out = expressionSafeJson(value);
  assert.ok(!/\{\{|\}\}/.test(out), out);
  assert.deepEqual(new Function(`return ${out};`)(), value);
});

test('replay-input-mismatch: a replayed read fed a different number of items than recorded is reported', () => {
  const wf: N8nWorkflow = {
    name: 'w',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: {}, name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [200, 0] },
      { parameters: { url: 'https://erp.example.com/x' }, name: 'Lookup', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [400, 0] },
    ],
    connections: { Webhook: { main: [[{ node: 'IF', type: 'main', index: 0 }]] }, IF: { main: [[], [{ node: 'Lookup', type: 'main', index: 0 }]] } },
  };
  // Lookup hangs off the false output of IF; the recorded input count must come from output 1, not output 0.
  const fixture = fixtureFromExecution(
    {
      id: 7,
      workflowData: wf,
      data: {
        resultData: {
          runData: {
            Webhook: [{ startTime: 1, data: { main: [[{ json: {} }, { json: {} }, { json: {} }]] } }],
            IF: [{ startTime: 2, source: [{ previousNode: 'Webhook' }], data: { main: [[{ json: {} }], [{ json: {} }, { json: {} }]] } }],
            Lookup: [{ startTime: 3, source: [{ previousNode: 'IF', previousNodeOutput: 1 }], data: { main: [[{ json: { a: 1 } }, { json: { a: 2 } }]] } }],
          },
        },
      },
    },
    wf,
  );
  assert.equal(fixture.nodes.Lookup?.runs[0]?.inputCount, 2);
  assert.deepEqual(replayInputWarnings(fixture, ['Lookup'], { Lookup: 2 }), []);
  const [warning] = replayInputWarnings(fixture, ['Lookup'], { Lookup: 5 });
  assert.match(warning ?? '', /^replay-input-mismatch: "Lookup" was recorded with 2 input items but got 5/);
});

test('a user node with the reserved frt: prefix is refused with a clear message', () => {
  const wf: N8nWorkflow = {
    name: 'w',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: {}, name: 'frt:start', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [200, 0] },
    ],
    connections: { Webhook: { main: [[{ node: 'frt:start', type: 'main', index: 0 }]] } },
  };
  const fixture: Fixture = { schemaVersion: 1, source: { workflowId: 'w', executionId: '1' }, trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: [{ json: {} }] }, nodes: {}, redacted: false };
  assert.throws(() => rewriteWorkflow(wf, fixture, classify(wf, { triggerNode: 'Webhook' }).roles, { version: 'new', caseId: '1', replayVariant: 'code' }), /reserved prefix "frt:"/);
});

test('S013 catches expression URLs and every loopback form; S008 catches $env outside Code', () => {
  const http = (name: string, url: string) => ({ parameters: { method: 'POST', url }, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0] as [number, number] });
  const wf: N8nWorkflow = {
    name: 'w',
    nodes: [
      { parameters: {}, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      http('Expr', '=http://localhost:5678/webhook/{{ $json.id }}'),
      http('V6', 'http://[::1]:8080/x'),
      http('Loop2', 'http://127.0.1.1/x'),
      http('Remote', 'https://erp.example.com/x'),
      http('Env', '={{ $env.ERP_URL }}/orders'),
    ],
    connections: {},
  };
  const findings = scanWorkflow(wf, classify(wf, { triggerNode: 'Webhook' })).findings;
  const s013 = findings.filter((f) => f.rule === 'S013').map((f) => f.node).sort();
  assert.deepEqual(s013, ['Expr', 'Loop2', 'V6']);
  assert.deepEqual(findings.filter((f) => f.rule === 'S008').map((f) => f.node), ['Env']);
});

test('JUnit escaping drops characters XML 1.0 does not allow', () => {
  const out = xmlEscape('bad \u001b[31m esc & <tag> "q" \ud800 end');
  // eslint-disable-next-line no-control-regex -- the test looks for control characters
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(out));
  assert.ok(!/[\ud800-\udfff]/.test(out));
  assert.match(out, /&amp; &lt;tag&gt; &quot;q&quot;/);
});
