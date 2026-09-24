/**
 * Day 4 of the spike: app nodes writing through the sink with credential
 * stubs (token and OAuth2), the token rule, and executeBatch timing.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, rewriteWorkflow, type Fixture, type N8nNode, type N8nWorkflow, type RecordedItem } from '@flowretest/core';
import { blockRule, buildCredentialStubs, genericSinkRule, serviceRole, serviceRules } from '@flowretest/services';
import { SandboxSession } from '../sandbox/session.ts';
import { extractRun } from '../sandbox/probe-workflow.ts';

function webhook(): N8nNode {
  return { parameters: { path: 'lead', httpMethod: 'POST' }, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] };
}

function items(): RecordedItem[] {
  return [
    { json: { headers: {}, params: {}, query: {}, body: { email: 'a@b.pl', customer_id: 'C-1' } } },
    { json: { headers: {}, params: {}, query: {}, body: { email: 'c@d.pl', customer_id: 'C-2' } } },
  ];
}

function flatten(): N8nNode {
  return {
    parameters: { assignments: { assignments: [{ id: 'a0', name: 'email', value: '={{ $json.body.email }}', type: 'string' }, { id: 'a1', name: 'customer_id', value: '={{ $json.body.customer_id }}', type: 'string' }] }, includeOtherFields: false, options: {} },
    name: 'Flatten',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [300, 0],
  };
}

interface Scenario {
  key: string;
  node: N8nNode;
  expectHost: string;
}

function scenarios(): Scenario[] {
  const rl = (mode: string, value: string) => ({ __rl: true, mode, value });
  return [
    {
      key: 'slack-token',
      expectHost: 'slack.com',
      node: { parameters: { authentication: 'accessToken', resource: 'message', operation: 'post', select: 'channel', channelId: rl('id', 'C0FRTMOCK'), messageType: 'text', text: '={{ $json.email }}', otherOptions: {} }, name: 'Slack', type: 'n8n-nodes-base.slack', typeVersion: 2.7, position: [600, 0], credentials: { slackApi: { id: 'frtslacktoken01', name: 'Slack token' } } },
    },
    {
      key: 'slack-oauth',
      expectHost: 'slack.com',
      node: { parameters: { authentication: 'oAuth2', resource: 'message', operation: 'post', select: 'channel', channelId: rl('id', 'C0FRTMOCK'), messageType: 'text', text: '={{ $json.email }}', otherOptions: {} }, name: 'Slack', type: 'n8n-nodes-base.slack', typeVersion: 2.7, position: [600, 0], credentials: { slackOAuth2Api: { id: 'frtslackoauth01', name: 'Slack OAuth2' } } },
    },
    {
      key: 'hubspot-token',
      expectHost: 'api.hubapi.com',
      node: { parameters: { authentication: 'appToken', resource: 'contact', operation: 'upsert', email: '={{ $json.email }}', additionalFields: { customerId: '={{ $json.customer_id }}' }, options: {} }, name: 'HubSpot', type: 'n8n-nodes-base.hubspot', typeVersion: 2.2, position: [600, 0], credentials: { hubspotAppToken: { id: 'frthubtoken0001', name: 'HubSpot token' } } },
    },
    {
      key: 'hubspot-oauth',
      expectHost: 'api.hubapi.com',
      node: { parameters: { authentication: 'oAuth2', resource: 'contact', operation: 'upsert', email: '={{ $json.email }}', additionalFields: {}, options: {} }, name: 'HubSpot', type: 'n8n-nodes-base.hubspot', typeVersion: 2.2, position: [600, 0], credentials: { hubspotOAuth2Api: { id: 'frthuboauth0001', name: 'HubSpot OAuth2' } } },
    },
    {
      key: 'sheets-oauth',
      expectHost: 'sheets.googleapis.com',
      node: { parameters: { authentication: 'oAuth2', resource: 'sheet', operation: 'append', documentId: rl('id', '1frtMockSpreadsheetId'), sheetName: rl('name', 'Sheet1'), columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] }, options: {} }, name: 'Sheets', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [600, 0], credentials: { googleSheetsOAuth2Api: { id: 'frtsheetsoauth1', name: 'Sheets OAuth2' } } },
    },
    {
      key: 'sheets-service-account',
      expectHost: 'sheets.googleapis.com',
      node: { parameters: { authentication: 'serviceAccount', resource: 'sheet', operation: 'append', documentId: rl('id', '1frtMockSpreadsheetId'), sheetName: rl('name', 'Sheet1'), columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] }, options: {} }, name: 'Sheets', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [600, 0], credentials: { googleApi: { id: 'frtgoogleapi001', name: 'Google service account' } } },
    },
  ];
}

export interface SpikeDay4Options {
  n8nImage: string;
  proxyImage: string;
  explore?: boolean;
  keep?: boolean;
  outFile?: string;
  log: (line: string) => void;
}

export interface Day4Result {
  scenario: string;
  status: string;
  error?: string;
  calls: Array<{ method: string; host: string; path: string; rule: string; status: unknown }>;
  writes: number;
  durationMs: number;
}

export async function runSpikeDay4(options: SpikeDay4Options): Promise<{ results: Day4Result[]; batch?: { durationMs: number; perCaseMs: number; sequentialMs: number; outputHasRunData: boolean; note: string } }> {
  const runDir = mkdtempSync(join(tmpdir(), 'flowretest-day4-'));
  const session = new SandboxSession({ runDir, n8nImage: options.n8nImage, proxyImage: options.proxyImage, timezone: 'UTC', logLevel: 'info', keep: options.keep, log: options.log });
  const rules = {
    schemaVersion: 1,
    rules: [
      ...serviceRules({ sheetHeaders: ['email', 'customer_id'] }),
      genericSinkRule(),
      ...(options.explore ? [{ id: 'explore-any-get', match: {}, respond: { status: 200, json: {} } }] : []),
      blockRule(),
    ],
  };
  const results: Day4Result[] = [];
  let batch: Awaited<ReturnType<typeof runSpikeDay4>>['batch'];
  try {
    await session.start(rules);
    mkdirSync(join(session.dirs.work, 'cases'), { recursive: true });
    const cases: Array<{ scenario: Scenario; id: string }> = [];
    const uses = [];
    for (const scenario of scenarios()) {
      const workflow: N8nWorkflow = {
        name: scenario.key,
        nodes: [webhook(), flatten(), scenario.node],
        connections: { Webhook: { main: [[{ node: 'Flatten', type: 'main', index: 0 }]] }, Flatten: { main: [[{ node: scenario.node.name, type: 'main', index: 0 }]] } },
      };
      const fixture: Fixture = {
        schemaVersion: 1,
        source: { workflowId: 'spike4', executionId: '0' },
        trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: items() },
        nodes: { Webhook: { type: 'n8n-nodes-base.webhook', typeVersion: 2, runs: [{ outputs: [items()] }] } },
        redacted: false,
      };
      const c = classify(workflow, { triggerNode: 'Webhook', serviceRole });
      if (c.roles[scenario.node.name] !== 'write') throw new Error(`${scenario.key}: expected write role, got ${c.roles[scenario.node.name]}`);
      const r = rewriteWorkflow(workflow, fixture, c.roles, { version: scenario.key, caseId: 'code', replayVariant: 'code' });
      session.writeWork(`cases/${scenario.key}.json`, JSON.stringify(r.workflow, null, 2));
      uses.push(...r.credentials);
      cases.push({ scenario, id: r.id });
    }
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const { stubs, unknownTypes } = buildCredentialStubs(uses, { privateKeyPem: () => pem });
    if (unknownTypes.length) options.log(`unknown credential types: ${unknownTypes.join(', ')}`);
    const credsPath = session.writeWork('credentials.json', JSON.stringify(stubs));
    const credImport = await session.n8n(['import:credentials', `--input=${credsPath}`]);
    options.log(`import:credentials exit ${credImport.code}${credImport.code !== 0 ? ' ' + (await session.n8nErrors(3)).join(' | ') : ''}`);
    const wfImport = await session.n8n(['import:workflow', '--separate', '--input=/work/cases/']);
    options.log(`import:workflow exit ${wfImport.code}${wfImport.code !== 0 ? ' ' + (await session.n8nErrors(3)).join(' | ') : ''}`);
    if (wfImport.code !== 0) return { results };

    let sequentialMs = 0;
    for (const c of cases) {
      session.setContext(c.scenario.key, 'code');
      const started = Date.now();
      const exec = await session.n8n(['execute', `--id=${c.id}`, '--rawOutput'], { consoleLog: true });
      const durationMs = Date.now() - started;
      sequentialMs += durationMs;
      let status = `exit ${exec.code}`;
      let error: string | undefined;
      if (exec.code === 0) {
        try {
          const run = extractRun(exec.stdout) as { status?: string; data?: { resultData?: { error?: { message?: string; description?: string; node?: { name?: string } } } } };
          status = run.status ?? 'unknown';
          const err = run.data?.resultData?.error;
          if (err) error = `${err.node?.name ?? '?'}: ${err.message ?? 'error'}${err.description ? ' / ' + String(err.description).slice(0, 160) : ''}`;
        } catch (e) {
          status = 'unparsed';
          error = e instanceof Error ? e.message : String(e);
        }
      } else {
        error = (await session.n8nErrors(2)).join(' | ');
      }
      const lines = session.readCapture().map((l) => JSON.parse(l) as { version: string; case: string; method: string; host: string; path: string; rule: { id: string }; response: { status: unknown } });
      const mine = lines.filter((l) => l.version === c.scenario.key);
      const calls = mine.map((l) => ({ method: l.method, host: l.host, path: l.path, rule: l.rule.id, status: l.response.status }));
      const writes = mine.filter((l) => l.host === c.scenario.expectHost && !['GET', 'HEAD', 'OPTIONS'].includes(l.method)).length;
      results.push({ scenario: c.scenario.key, status, error, calls, writes, durationMs });
      options.log(`${c.scenario.key}: ${status} writes=${writes}${error ? ' error=' + error : ''} (${durationMs} ms)`);
      for (const call of calls) options.log(`    ${call.method} ${call.host}${call.path} -> ${call.rule} ${String(call.status)}`);
    }

    // executeBatch: all cases in one process, sequentially.
    session.setContext('batch', 'all');
    const ids = cases.map((c) => c.id).join(',');
    const started = Date.now();
    mkdirSync(join(session.dirs.out, 'snap'), { recursive: true });
    const be = await session.n8n(['executeBatch', `--ids=${ids}`, '--concurrency=1', '--output=/out/batch.json', '--snapshot=/out/snap/'], { consoleLog: true, timeoutMs: 600_000 });
    const durationMs = Date.now() - started;
    const outPath = join(session.dirs.out, 'batch.json');
    let outputHasRunData = false;
    let note = `exit ${be.code}`;
    if (existsSync(outPath)) {
      const text = readFileSync(outPath, 'utf8');
      note += `, output ${text.length} bytes, keys ${Object.keys(JSON.parse(text)).join(',').slice(0, 120)}`;
    } else {
      note += ', no output file; stdout tail: ' + be.stdout.trim().split('\n').slice(-2).join(' | ').slice(0, 300);
    }
    const snapDir = join(session.dirs.out, 'snap');
    const snapFiles = existsSync(snapDir) ? readdirSync(snapDir) : [];
    note += `; snapshots: ${snapFiles.length}`;
    const firstSnap = snapFiles[0];
    if (firstSnap) {
      const snap = JSON.parse(readFileSync(join(snapDir, firstSnap), 'utf8')) as { data?: { resultData?: { runData?: Record<string, Array<{ startTime?: number; executionTime?: number }>> } }; mode?: string; startedAt?: string; stoppedAt?: string };
      const runData = snap.data?.resultData?.runData ?? {};
      const nodeNames = Object.keys(runData);
      const firstRun = runData[nodeNames[0] ?? '']?.[0];
      outputHasRunData = nodeNames.length > 0;
      note += ` (${firstSnap}: top keys ${Object.keys(snap).join(',')}; nodes ${nodeNames.join(',')}; startTime ${firstRun?.startTime}, executionTime ${firstRun?.executionTime}, startedAt ${snap.startedAt}, stoppedAt ${snap.stoppedAt})`;
    }
    batch = { durationMs, perCaseMs: Math.round(durationMs / cases.length), sequentialMs, outputHasRunData, note };
    options.log(`executeBatch: ${durationMs} ms for ${cases.length} cases (sequential execute: ${sequentialMs} ms); ${note}`);
  } finally {
    await session.stop();
  }
  if (options.outFile) {
    mkdirSync(join(options.outFile, '..'), { recursive: true });
    writeFileSync(options.outFile, JSON.stringify({ results, batch }, null, 2));
  }
  return { results, batch };
}
