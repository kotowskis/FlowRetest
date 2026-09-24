/**
 * Days 5 and 6 of the spike: the node matrix. Which nodes are captured by the
 * proxy, which fail loudly, which would leak. Roles are forced so every node
 * under test is executed for real.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, rewriteWorkflow, type Fixture, type N8nNode, type N8nWorkflow, type NodeRole, type RecordedItem } from '@flowretest/core';
import { blockRule, buildCredentialStubs, genericSinkRule, serviceRules } from '@flowretest/services';
import { SandboxSession } from '../sandbox/session.ts';
import { extractRun, logErrors } from '../sandbox/probe-workflow.ts';

const rl = (mode: string, value: string) => ({ __rl: true, mode, value });

function webhook(): N8nNode {
  return { parameters: { path: 'lead', httpMethod: 'POST' }, name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] };
}

function items(): RecordedItem[] {
  return [{ json: { headers: {}, params: {}, query: {}, body: { email: 'a@b.pl', customer_id: 'C-1' } } }];
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

type Expectation = 'captured' | 'loud-failure';

interface Scenario {
  key: string;
  expect: Expectation;
  /** Host whose write call proves capture. */
  host?: string;
  nodes: N8nNode[];
  /** Extra connections besides Flatten -> first node. */
  connections?: N8nWorkflow['connections'];
  roles?: Record<string, NodeRole>;
}

function scenarios(): Scenario[] {
  return [
    {
      key: 'airtable-record-create',
      expect: 'captured',
      host: 'api.airtable.com',
      nodes: [{ parameters: { authentication: 'airtableTokenApi', resource: 'record', operation: 'create', base: rl('id', 'appFRTMOCK'), table: rl('id', 'tblFRTMOCK'), columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] }, options: {} }, name: 'Airtable', type: 'n8n-nodes-base.airtable', typeVersion: 2.1, position: [600, 0], credentials: { airtableTokenApi: { id: 'frtairtable0001', name: 'Airtable token' } } }],
    },
    {
      key: 'notion-page-create',
      expect: 'captured',
      host: 'api.notion.com',
      nodes: [{ parameters: { authentication: 'apiKey', resource: 'databasePage', operation: 'create', dataSourceId: rl('id', '12345678-1234-4123-8123-123456789abc'), title: '={{ $json.email }}', propertiesUi: {}, options: {} }, name: 'Notion', type: 'n8n-nodes-base.notion', typeVersion: 3, position: [600, 0], credentials: { notionApi: { id: 'frtnotion000001', name: 'Notion' } } }],
    },
    {
      key: 'openai-llm-chain',
      expect: 'captured',
      host: 'api.openai.com',
      nodes: [
        { parameters: { promptType: 'define', text: '={{ $json.email }}', messages: {}, batching: {} }, name: 'LLM Chain', type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1.7, position: [600, 0] },
        { parameters: { model: rl('list', 'gpt-4o-mini'), options: {} }, name: 'OpenAI Chat Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.2, position: [600, 200], credentials: { openAiApi: { id: 'frtopenai000001', name: 'OpenAI' } } },
      ],
      connections: { 'OpenAI Chat Model': { ai_languageModel: [[{ node: 'LLM Chain', type: 'ai_languageModel', index: 0 }]] } },
      roles: { 'LLM Chain': 'write', 'OpenAI Chat Model': 'logic' },
    },
    {
      key: 'gemini-llm-chain',
      expect: 'loud-failure',
      host: 'generativelanguage.googleapis.com',
      nodes: [
        { parameters: { promptType: 'define', text: '={{ $json.email }}', messages: {}, batching: {} }, name: 'LLM Chain', type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1.7, position: [600, 0] },
        { parameters: { modelName: 'models/gemini-2.0-flash', options: {} }, name: 'Gemini Chat Model', type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', typeVersion: 1.1, position: [600, 200], credentials: { googlePalmApi: { id: 'frtgemini000001', name: 'Gemini' } } },
      ],
      connections: { 'Gemini Chat Model': { ai_languageModel: [[{ node: 'LLM Chain', type: 'ai_languageModel', index: 0 }]] } },
      roles: { 'LLM Chain': 'write', 'Gemini Chat Model': 'logic' },
    },
    {
      key: 'postgres-insert',
      expect: 'loud-failure',
      nodes: [{ parameters: { operation: 'insert', schema: rl('list', 'public'), table: rl('list', 'orders'), columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] }, options: {} }, name: 'Postgres', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [600, 0], credentials: { postgres: { id: 'frtpostgres0001', name: 'Postgres' } } }],
      roles: { Postgres: 'write' },
    },
    {
      key: 'code-fetch',
      expect: 'loud-failure',
      host: 'erp.example.com',
      nodes: [{ parameters: { jsCode: "const r = await fetch('https://erp.example.com/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify($input.first().json) });\nreturn [{ json: { status: r.status } }];", mode: 'runOnceForAllItems', language: 'javaScript' }, name: 'Code fetch', type: 'n8n-nodes-base.code', typeVersion: 2, position: [600, 0] }],
    },
    {
      key: 'code-helpers-httpRequest',
      expect: 'captured',
      host: 'erp.example.com',
      nodes: [{ parameters: { jsCode: "const r = await this.helpers.httpRequest({ method: 'POST', url: 'https://erp.example.com/api/orders', body: $input.first().json, json: true });\nreturn [{ json: r }];", mode: 'runOnceForAllItems', language: 'javaScript' }, name: 'Code helpers', type: 'n8n-nodes-base.code', typeVersion: 2, position: [600, 0] }],
    },
    {
      key: 'http-multipart-text',
      expect: 'captured',
      host: 'erp.example.com',
      nodes: [{ parameters: { method: 'POST', url: 'https://erp.example.com/api/upload', sendBody: true, contentType: 'multipart-form-data', bodyParameters: { parameters: [{ parameterType: 'formData', name: 'note', value: '={{ $json.email }}' }] }, options: {} }, name: 'Upload', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [600, 0] }],
    },
    {
      key: 'http-multipart-binary',
      expect: 'captured',
      host: 'erp.example.com',
      nodes: [
        { parameters: { operation: 'toJson', options: {} }, name: 'To file', type: 'n8n-nodes-base.convertToFile', typeVersion: 1.1, position: [600, 0] },
        { parameters: { method: 'POST', url: 'https://erp.example.com/api/upload', sendBody: true, contentType: 'multipart-form-data', bodyParameters: { parameters: [{ parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' }] }, options: {} }, name: 'Upload', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [900, 0] },
      ],
      connections: { 'To file': { main: [[{ node: 'Upload', type: 'main', index: 0 }]] } },
      roles: { 'To file': 'logic' },
    },
  ];
}

export interface SpikeDay5Options {
  n8nImage: string;
  proxyImage: string;
  keep?: boolean;
  outFile?: string;
  log: (line: string) => void;
}

export interface Day5Result {
  scenario: string;
  expect: Expectation;
  verdict: 'ok' | 'unexpected';
  status: string;
  error?: string;
  calls: Array<{ method: string; host: string; path: string; rule: string; status: unknown; multipart?: unknown }>;
  durationMs: number;
}

export async function runSpikeDay5(options: SpikeDay5Options): Promise<Day5Result[]> {
  const runDir = mkdtempSync(join(tmpdir(), 'flowretest-day5-'));
  const session = new SandboxSession({ runDir, n8nImage: options.n8nImage, proxyImage: options.proxyImage, timezone: 'UTC', logLevel: 'info', keep: options.keep, log: options.log });
  const rules = { schemaVersion: 1, rules: [...serviceRules({ sheetHeaders: ['email', 'customer_id'] }), genericSinkRule(), blockRule()] };
  const results: Day5Result[] = [];
  try {
    await session.start(rules);
    mkdirSync(join(session.dirs.work, 'cases'), { recursive: true });
    const cases: Array<{ scenario: Scenario; id: string }> = [];
    const uses = [];
    for (const scenario of scenarios()) {
      const first = scenario.nodes[0] as N8nNode;
      const workflow: N8nWorkflow = {
        name: scenario.key,
        nodes: [webhook(), flatten(), ...scenario.nodes],
        connections: { Webhook: { main: [[{ node: 'Flatten', type: 'main', index: 0 }]] }, Flatten: { main: [[{ node: first.name, type: 'main', index: 0 }]] }, ...(scenario.connections ?? {}) },
      };
      const fixture: Fixture = {
        schemaVersion: 1,
        source: { workflowId: 'spike5', executionId: '0' },
        trigger: { node: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, items: items() },
        nodes: { Webhook: { type: 'n8n-nodes-base.webhook', typeVersion: 2, runs: [{ outputs: [items()] }] } },
        redacted: false,
      };
      const c = classify(workflow, { triggerNode: 'Webhook' });
      const roles = { ...c.roles, ...(scenario.roles ?? {}) };
      for (const node of scenario.nodes) if (roles[node.name] === 'unsupported') roles[node.name] = 'write';
      const r = rewriteWorkflow(workflow, fixture, roles, { version: scenario.key, caseId: 'matrix', replayVariant: 'code', executionTimeoutSeconds: 60 });
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
    if (wfImport.code !== 0) return results;

    for (const c of cases) {
      session.setContext(c.scenario.key, 'matrix');
      const started = Date.now();
      const exec = await session.n8n(['execute', `--id=${c.id}`, '--rawOutput'], { consoleLog: true, timeoutMs: 180_000 });
      const durationMs = Date.now() - started;
      let status = `exit ${exec.code}`;
      let error: string | undefined;
      if (exec.code === 0) {
        try {
          const run = extractRun(exec.stdout) as { status?: string; data?: { resultData?: { error?: { message?: string; description?: string; node?: { name?: string } } } } };
          status = run.status ?? 'unknown';
          const err = run.data?.resultData?.error;
          if (err) error = `${err.node?.name ?? '?'}: ${err.message ?? 'error'}${err.description ? ' / ' + String(err.description).slice(0, 200) : ''}`;
        } catch (e) {
          status = 'unparsed';
          error = e instanceof Error ? e.message : String(e);
        }
      } else {
        error = [...logErrors(exec.stdout, 3), ...logErrors(exec.stderr, 2)].join(' | ') || exec.stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 300);
      }
      const lines = session.readCapture().map((l) => JSON.parse(l) as { version: string; method: string; host: string; path: string; rule: { id: string }; response: { status: unknown }; multipart?: unknown });
      const mine = lines.filter((l) => l.version === c.scenario.key);
      const calls = mine.map((l) => ({ method: l.method, host: l.host, path: l.path, rule: l.rule.id, status: l.response.status, multipart: l.multipart }));
      const captured = c.scenario.host ? mine.some((l) => l.host === c.scenario.host && !['GET', 'HEAD', 'OPTIONS'].includes(l.method)) : false;
      const loud = status !== 'success' || error !== undefined;
      const verdict: Day5Result['verdict'] = c.scenario.expect === 'captured' ? (captured && !loud ? 'ok' : 'unexpected') : (!captured && loud ? 'ok' : 'unexpected');
      results.push({ scenario: c.scenario.key, expect: c.scenario.expect, verdict, status, error, calls, durationMs });
      options.log(`${verdict === 'ok' ? 'ok  ' : 'DIFF'} ${c.scenario.key} (expect ${c.scenario.expect}): ${status}${error ? ' error=' + error : ''} (${durationMs} ms)`);
      for (const call of calls) options.log(`      ${call.method} ${call.host}${call.path} -> ${call.rule} ${String(call.status)}${call.multipart ? ' multipart=' + JSON.stringify(call.multipart) : ''}`);
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
