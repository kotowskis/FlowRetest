/**
 * Day 3 of the feasibility spike: trigger substitution, both replay variants,
 * credential stubs, Code node under the task runner, Respond to Webhook.
 * Synthetic workflows and fixtures, one sandbox, results as a table and JSON.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, rewriteWorkflow, type Fixture, type N8nNode, type N8nWorkflow, type RecordedItem, type ReplayVariant } from '@flowretest/core';
import { buildCredentialStubs } from '@flowretest/services';
import { SandboxSession } from '../sandbox/session.ts';
import { extractRun } from '../sandbox/probe-workflow.ts';

const CRED = { httpHeaderAuth: { id: 'frtcred0000001', name: 'ERP header' } };

function trigger(name: string, type: string, typeVersion: number, parameters: Record<string, unknown> = {}): N8nNode {
  return { parameters, name, type, typeVersion, position: [0, 0] };
}

function map(name: string, position: [number, number], assignments: Array<[string, string]>): N8nNode {
  return {
    parameters: {
      assignments: { assignments: assignments.map(([field, value], i) => ({ id: `a${i}`, name: field, value, type: 'string' })) },
      includeOtherFields: false,
      options: {},
    },
    name,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position,
  };
}

function push(name: string, position: [number, number]): N8nNode {
  return {
    parameters: {
      method: 'POST',
      url: 'https://erp.example.com/api/orders',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json) }}',
      options: {},
    },
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    credentials: CRED,
  };
}

function lookup(name: string, position: [number, number]): N8nNode {
  return {
    parameters: { method: 'GET', url: 'https://crm.example.com/customers', options: {} },
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
  };
}

function chain(...names: string[]): N8nWorkflow['connections'] {
  const connections: N8nWorkflow['connections'] = {};
  for (let i = 0; i < names.length - 1; i++) {
    connections[names[i] as string] = { main: [[{ node: names[i + 1] as string, type: 'main', index: 0 }]] };
  }
  return connections;
}

function webhookItems(): RecordedItem[] {
  return [
    { json: { headers: {}, params: {}, query: {}, body: { email: 'a@b.pl', customer_id: 'C-1' } } },
    { json: { headers: {}, params: {}, query: {}, body: { email: 'c@d.pl', customer_id: 'C-2' } } },
  ];
}

function fixtureFor(triggerNode: N8nNode, items: RecordedItem[], nodes: Fixture['nodes'] = {}): Fixture {
  return {
    schemaVersion: 1,
    source: { workflowId: 'spike', executionId: '0' },
    trigger: { node: triggerNode.name, type: triggerNode.type, typeVersion: triggerNode.typeVersion, items },
    nodes: { [triggerNode.name]: { type: triggerNode.type, typeVersion: triggerNode.typeVersion, runs: [{ outputs: [items] }] }, ...nodes },
    redacted: false,
  };
}

interface Scenario {
  key: string;
  expect: string;
  workflow: N8nWorkflow;
  fixture: Fixture;
}

function scenarios(): Scenario[] {
  const out: Scenario[] = [];

  const webhook = trigger('Webhook', 'n8n-nodes-base.webhook', 2, { path: 'lead', httpMethod: 'POST' });
  out.push({
    key: 'trigger-webhook',
    expect: '2 POST with email from $(Webhook).item and cid from $json',
    workflow: {
      name: 'A', nodes: [webhook, map('Map', [300, 0], [['email', "={{ $('Webhook').item.json.body.email }}"], ['cid', '={{ $json.body.customer_id }}']]), push('Push', [600, 0])],
      connections: chain('Webhook', 'Map', 'Push'),
    },
    fixture: fixtureFor(webhook, webhookItems()),
  });

  const hubspot = trigger('HubSpot Trigger', 'n8n-nodes-base.hubspotTrigger', 1, { eventsUi: {} });
  const hubspotItems: RecordedItem[] = [{ json: { objectId: 1, propertyName: 'email', propertyValue: 'a@b.pl' } }, { json: { objectId: 2, propertyName: 'email', propertyValue: 'c@d.pl' } }];
  out.push({
    key: 'trigger-hubspot',
    expect: '2 POST with email from $(HubSpot Trigger).item',
    workflow: {
      name: 'B', nodes: [hubspot, map('Map', [300, 0], [['email', "={{ $('HubSpot Trigger').item.json.propertyValue }}"], ['cid', '={{ $json.objectId }}']]), push('Push', [600, 0])],
      connections: chain('HubSpot Trigger', 'Map', 'Push'),
    },
    fixture: fixtureFor(hubspot, hubspotItems),
  });

  const schedule = trigger('Schedule Trigger', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'days' }] } });
  out.push({
    key: 'trigger-schedule',
    expect: '1 POST with ts from $(Schedule Trigger).item',
    workflow: {
      name: 'B2', nodes: [schedule, map('Map', [300, 0], [['ts', "={{ $('Schedule Trigger').item.json.timestamp }}"]]), push('Push', [600, 0])],
      connections: chain('Schedule Trigger', 'Map', 'Push'),
    },
    fixture: fixtureFor(schedule, [{ json: { timestamp: '2026-09-21T08:00:00.000Z', 'Readable date': 'September 21st 2026' } }]),
  });

  const webhookC = trigger('Webhook', 'n8n-nodes-base.webhook', 2, { path: 'lead', httpMethod: 'POST' });
  out.push({
    key: 'read-replay-pairing',
    expect: '2 POST, cid C-1 with a@b.pl and C-2 with c@d.pl (pairing through the replayed read node)',
    workflow: {
      name: 'C', nodes: [webhookC, lookup('Lookup', [300, 0]), map('Map', [600, 0], [['email', "={{ $('Webhook').item.json.body.email }}"], ['cid', '={{ $json.id }}']]), push('Push', [900, 0])],
      connections: chain('Webhook', 'Lookup', 'Map', 'Push'),
    },
    fixture: fixtureFor(webhookC, webhookItems(), {
      Lookup: { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, runs: [{ inputCount: 2, outputs: [[{ json: { id: 'C-1' }, pairedItem: { item: 0 } }, { json: { id: 'C-2' }, pairedItem: { item: 1 } }]] }] },
    }),
  });

  const webhookD = trigger('Webhook', 'n8n-nodes-base.webhook', 2, { path: 'lead', httpMethod: 'POST' });
  out.push({
    key: 'code-node',
    expect: '2 POST with n 0 and 1 (Code node ran in the task runner)',
    workflow: {
      name: 'D',
      nodes: [
        webhookD,
        { parameters: { jsCode: 'return $input.all().map((item, n) => ({ json: { ...item.json.body, n } }));', mode: 'runOnceForAllItems', language: 'javaScript' }, name: 'Transform', type: 'n8n-nodes-base.code', typeVersion: 2, position: [300, 0] },
        push('Push', [600, 0]),
      ],
      connections: chain('Webhook', 'Transform', 'Push'),
    },
    fixture: fixtureFor(webhookD, webhookItems()),
  });

  const webhookE = trigger('Webhook', 'n8n-nodes-base.webhook', 2, { path: 'lead', httpMethod: 'POST', responseMode: 'responseNode' });
  out.push({
    key: 'respond-to-webhook',
    expect: '2 POST after a Respond to Webhook replaced by No Operation',
    workflow: {
      name: 'E',
      nodes: [webhookE, { parameters: { respondWith: 'json', responseBody: '{"ok":true}', options: {} }, name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [300, 0] }, map('Map', [600, 0], [['email', '={{ $json.body.email }}']]), push('Push', [900, 0])],
      connections: chain('Webhook', 'Respond', 'Map', 'Push'),
    },
    fixture: fixtureFor(webhookE, webhookItems()),
  });

  const webhookF = trigger('Webhook', 'n8n-nodes-base.webhook', 2, { path: 'lead', httpMethod: 'POST' });
  const loop: N8nNode = { parameters: { batchSize: 1, options: {} }, name: 'Loop', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [300, 0] };
  out.push({
    key: 'multirun-read-in-loop',
    expect: '2 POST with cid C-1 then C-2 (read node replayed per $runIndex inside Loop Over Items)',
    workflow: {
      name: 'F',
      nodes: [webhookF, loop, lookup('Lookup', [600, 100]), map('Map', [900, 100], [['cid', '={{ $json.id }}']]), push('Push', [1200, 100])],
      connections: {
        Webhook: { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
        Loop: { main: [[], [{ node: 'Lookup', type: 'main', index: 0 }]] },
        Lookup: { main: [[{ node: 'Map', type: 'main', index: 0 }]] },
        Map: { main: [[{ node: 'Push', type: 'main', index: 0 }]] },
        Push: { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
      },
    },
    fixture: fixtureFor(webhookF, webhookItems(), {
      Lookup: {
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        runs: [
          { inputCount: 1, outputs: [[{ json: { id: 'C-1' }, pairedItem: { item: 0 } }]] },
          { inputCount: 1, outputs: [[{ json: { id: 'C-2' }, pairedItem: { item: 0 } }]] },
        ],
      },
    }),
  });

  return out;
}

export interface SpikeDay3Options {
  n8nImage: string;
  proxyImage: string;
  variants: ReplayVariant[];
  keep?: boolean;
  outFile?: string;
  log: (line: string) => void;
}

interface CaseResult {
  scenario: string;
  variant: ReplayVariant;
  expect: string;
  status: string;
  error?: string;
  posts: number;
  bodies: unknown[];
  blocked: number;
  durationMs: number;
}

export async function runSpikeDay3(options: SpikeDay3Options): Promise<CaseResult[]> {
  const runDir = mkdtempSync(join(tmpdir(), 'flowretest-day3-'));
  const session = new SandboxSession({ runDir, n8nImage: options.n8nImage, proxyImage: options.proxyImage, timezone: 'UTC', logLevel: 'info', keep: options.keep, log: options.log });
  const results: CaseResult[] = [];
  const rules = {
    schemaVersion: 1,
    rules: [
      { id: 'token', match: { path: '/token|/oauth' }, respond: { status: 200, json: { access_token: 'frt-mock', token_type: 'Bearer', expires_in: 3600 } } },
      { id: 'generic-sink', match: { method: 'POST|PUT|PATCH|DELETE' }, respond: { status: 200, json: { id: 'frt-{{seq}}', ok: true } } },
      { id: 'block', match: {}, respond: { close: true } },
    ],
  };
  try {
    await session.start(rules);
    const cases: Array<{ scenario: Scenario; variant: ReplayVariant; id: string; warnings: string[] }> = [];
    const credentialUses = [];
    mkdirSync(join(session.dirs.work, 'cases'), { recursive: true });
    for (const scenario of scenarios()) {
      for (const variant of options.variants) {
        const c = classify(scenario.workflow, { triggerNode: scenario.fixture.trigger.node });
        const r = rewriteWorkflow(scenario.workflow, scenario.fixture, c.roles, { version: scenario.key, caseId: variant, replayVariant: variant });
        session.writeWork(`cases/${scenario.key}-${variant}.json`, JSON.stringify(r.workflow, null, 2));
        credentialUses.push(...r.credentials);
        cases.push({ scenario, variant, id: r.id, warnings: r.warnings });
      }
    }
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const { stubs, unknownTypes } = buildCredentialStubs(credentialUses, { privateKeyPem: () => pem });
    if (unknownTypes.length) options.log(`unknown credential types: ${unknownTypes.join(', ')}`);
    const credsPath = session.writeWork('credentials.json', JSON.stringify(stubs));

    const credImport = await session.n8n(['import:credentials', `--input=${credsPath}`]);
    options.log(`import:credentials exit ${credImport.code}${credImport.code !== 0 ? ' ' + (await session.n8nErrors(3)).join(' | ') : ''}`);
    const wfImport = await session.n8n(['import:workflow', '--separate', '--input=/work/cases/']);
    options.log(`import:workflow exit ${wfImport.code}${wfImport.code !== 0 ? ' ' + (await session.n8nErrors(3)).join(' | ') : ''}`);
    if (wfImport.code !== 0) return results;

    for (const c of cases) {
      session.setContext(c.scenario.key, c.variant);
      const started = Date.now();
      const exec = await session.n8n(['execute', `--id=${c.id}`, '--rawOutput'], { consoleLog: true });
      const durationMs = Date.now() - started;
      let status = `exit ${exec.code}`;
      let error: string | undefined;
      if (exec.code === 0) {
        try {
          const run = extractRun(exec.stdout) as { status?: string; data?: { resultData?: { error?: { message?: string; node?: { name?: string } }; lastNodeExecuted?: string } } };
          status = run.status ?? 'unknown';
          const err = run.data?.resultData?.error;
          if (err) error = `${err.node?.name ?? '?'}: ${err.message ?? 'error'}`;
        } catch (e) {
          status = 'unparsed';
          error = e instanceof Error ? e.message : String(e);
        }
      } else {
        error = (await session.n8nErrors(2)).join(' | ');
      }
      const lines = session.readCapture().map((l) => JSON.parse(l) as { version: string; case: string; method: string; host: string; path: string; bodyJson?: unknown; response: { status: unknown } });
      const mine = lines.filter((l) => l.version === c.scenario.key && l.case === c.variant);
      const posts = mine.filter((l) => l.method === 'POST' && l.host === 'erp.example.com');
      results.push({
        scenario: c.scenario.key,
        variant: c.variant,
        expect: c.scenario.expect,
        status,
        error,
        posts: posts.length,
        bodies: posts.map((p) => p.bodyJson),
        blocked: mine.filter((l) => l.response.status === 'close').length,
        durationMs,
      });
      options.log(`${c.scenario.key} [${c.variant}] ${status} posts=${posts.length} blocked=${mine.length - posts.length}${error ? ' error=' + error : ''} (${durationMs} ms)`);
      for (const w of c.warnings) options.log(`  warning: ${w}`);
    }
  } finally {
    await session.stop();
  }
  if (options.outFile) {
    mkdirSync(join(options.outFile, '..'), { recursive: true });
    writeFileSync(options.outFile, JSON.stringify(results, null, 2));
  }
  return results;
}
