/**
 * Sink templates: enough of each API for n8n's write nodes to reach their
 * write call and get a plausible answer. Nothing here imitates a whole
 * service. Rules are evaluated in order by the proxy (first match wins).
 */

export interface SinkRule {
  id: string;
  match: { host?: string; method?: string; path?: string };
  respond: { status?: number; headers?: Record<string, string>; json?: unknown; body?: string; close?: boolean };
  times?: number;
}

export interface SinkContext {
  /** Header row served to Google Sheets before an append; from the recorded input keys of the node. */
  sheetHeaders?: string[];
}

/**
 * Header row for the Google Sheets and Airtable sinks, from what those nodes returned in the recordings: a Sheets
 * append or update returns the written row keyed by the sheet's columns, Airtable returns `fields`. With the real
 * columns a renamed or missing field lands in another column or none, as it would in production; with a fixed
 * header the regression would not show. Keys in first-seen order; `row_number` is n8n's own.
 */
export function sheetHeadersFromRecordings(nodes: Array<{ type: string; runs: Array<{ outputs: Array<Array<{ json: unknown }>> }> }>): string[] | undefined {
  const headers: string[] = [];
  const add = (value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    for (const key of Object.keys(value as Record<string, unknown>)) if (key !== 'row_number' && !headers.includes(key)) headers.push(key);
  };
  for (const node of nodes) {
    const sheets = node.type === 'n8n-nodes-base.googleSheets';
    const airtable = node.type === 'n8n-nodes-base.airtable';
    if (!sheets && !airtable) continue;
    for (const run of node.runs) for (const item of run.outputs[0] ?? []) add(sheets ? item.json : (item.json as { fields?: unknown } | null)?.fields);
  }
  return headers.length > 0 ? headers : undefined;
}

export function tokenRules(): SinkRule[] {
  return [
    {
      id: 'token',
      match: { method: 'POST', path: '(^|/)(token|oauth2/v[0-9]+/token|oauth/v[0-9]+/token|oauth/token|api/oauth\\.v2\\.access)$' },
      respond: { status: 200, json: { access_token: 'frt-mock', refresh_token: 'frt-mock', token_type: 'Bearer', expires_in: 3600, scope: '' } },
    },
  ];
}

export function slackRules(): SinkRule[] {
  const host = 'slack.com';
  return [
    { id: 'slack.chat.postMessage', match: { host, method: 'POST', path: '^/api/chat\\.postMessage$' }, respond: { status: 200, json: { ok: true, channel: '{{echo body.channel}}', ts: '1700000000.{{seq}}', message: { text: '{{echo body.text}}', type: 'message' } } } },
    { id: 'slack.chat.update', match: { host, method: 'POST', path: '^/api/chat\\.(update|delete|scheduleMessage|deleteScheduledMessage)$' }, respond: { status: 200, json: { ok: true, channel: '{{echo body.channel}}', ts: '{{echo body.ts}}' } } },
    { id: 'slack.conversations.list', match: { host, method: 'GET|POST', path: '^/api/(conversations\\.list|users\\.conversations)$' }, respond: { status: 200, json: { ok: true, channels: [{ id: 'C0FRTMOCK', name: 'general', is_channel: true }], response_metadata: { next_cursor: '' } } } },
    { id: 'slack.conversations.info', match: { host, method: 'GET|POST', path: '^/api/conversations\\.info$' }, respond: { status: 200, json: { ok: true, channel: { id: 'C0FRTMOCK', name: 'general', is_channel: true } } } },
    { id: 'slack.users.list', match: { host, method: 'GET|POST', path: '^/api/users\\.list$' }, respond: { status: 200, json: { ok: true, members: [], response_metadata: { next_cursor: '' } } } },
    { id: 'slack.auth.test', match: { host, method: 'GET|POST', path: '^/api/auth\\.test$' }, respond: { status: 200, json: { ok: true, user_id: 'UFRTMOCK', team_id: 'TFRTMOCK', user: 'frt', team: 'frt' } } },
    { id: 'slack.any', match: { host, method: 'GET|POST' }, respond: { status: 200, json: { ok: true } } },
  ];
}

export function hubspotRules(): SinkRule[] {
  const host = 'api.hubapi.com';
  return [
    { id: 'hubspot.contact.createOrUpdate', match: { host, method: 'POST', path: '^/contacts/v1/contact/createOrUpdate/email/' }, respond: { status: 200, json: { vid: '{{seq}}', isNew: true } } },
    { id: 'hubspot.contact.profile', match: { host, method: 'GET', path: '^/contacts/v1/contact/(vid|email)/' }, respond: { status: 200, json: { vid: 1, 'canonical-vid': 1, properties: { email: { value: 'frt@example.com' } }, 'is-contact': true } } },
    { id: 'hubspot.crm.objects.create', match: { host, method: 'POST', path: '^/crm/v3/objects/[a-z_]+$' }, respond: { status: 201, json: { id: '{{seq}}', properties: '{{echo body.properties}}', createdAt: '{{now}}', updatedAt: '{{now}}', archived: false } } },
    { id: 'hubspot.crm.objects.update', match: { host, method: 'PATCH', path: '^/crm/v3/objects/[a-z_]+/' }, respond: { status: 200, json: { id: 'frt-{{seq}}', properties: '{{echo body.properties}}', updatedAt: '{{now}}' } } },
    { id: 'hubspot.crm.objects.search', match: { host, method: 'POST', path: '^/crm/v3/objects/[a-z_]+/search$' }, respond: { status: 200, json: { total: 0, results: [] } } },
    { id: 'hubspot.crm.objects.get', match: { host, method: 'GET', path: '^/crm/v3/objects/' }, respond: { status: 200, json: { results: [], paging: {} } } },
    { id: 'hubspot.properties', match: { host, method: 'GET', path: '^/(crm/v3/properties|properties/v[0-9]+)/' }, respond: { status: 200, json: { results: [] } } },
    { id: 'hubspot.owners', match: { host, method: 'GET', path: '^/(owners|crm/v3/owners)' }, respond: { status: 200, json: { results: [] } } },
  ];
}

export function googleSheetsRules(ctx: SinkContext = {}): SinkRule[] {
  const host = 'sheets.googleapis.com';
  const headers = ctx.sheetHeaders ?? ['email', 'customer_id'];
  return [
    { id: 'sheets.values.append', match: { host, method: 'POST', path: '^/v4/spreadsheets/[^/]+/values/[^:]+:append$' }, respond: { status: 200, json: { spreadsheetId: 'frt', tableRange: 'Sheet1!A1:B1', updates: { spreadsheetId: 'frt', updatedRange: 'Sheet1!A2:B2', updatedRows: 1, updatedColumns: headers.length, updatedCells: headers.length } } } },
    { id: 'sheets.values.update', match: { host, method: 'PUT', path: '^/v4/spreadsheets/[^/]+/values/' }, respond: { status: 200, json: { spreadsheetId: 'frt', updatedRange: 'Sheet1!A2:B2', updatedRows: 1, updatedColumns: headers.length, updatedCells: headers.length } } },
    { id: 'sheets.values.batchUpdate', match: { host, method: 'POST', path: '^/v4/spreadsheets/[^/]+(/values)?:batchUpdate$' }, respond: { status: 200, json: { spreadsheetId: 'frt', totalUpdatedRows: 1, responses: [], replies: [] } } },
    { id: 'sheets.values.get', match: { host, method: 'GET', path: '^/v4/spreadsheets/[^/]+/values/' }, respond: { status: 200, json: { range: 'Sheet1!A1:Z1', majorDimension: 'ROWS', values: [headers] } } },
    { id: 'sheets.spreadsheet.get', match: { host, method: 'GET', path: '^/v4/spreadsheets/[^/]+$' }, respond: { status: 200, json: { spreadsheetId: 'frt', properties: { title: 'frt' }, sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } } }] } } },
  ];
}

export function airtableRules(ctx: SinkContext = {}): SinkRule[] {
  const host = 'api.airtable.com';
  const fields = (ctx.sheetHeaders ?? ['email', 'customer_id']).map((name, i) => ({ id: `fld${i}`, name, type: 'singleLineText' }));
  return [
    { id: 'airtable.meta.tables', match: { host, method: 'GET', path: '^/v0/meta/bases/[^/]+/tables' }, respond: { status: 200, json: { tables: [{ id: 'tblFRTMOCK', name: 'Orders', primaryFieldId: 'fld0', fields, views: [] }] } } },
    { id: 'airtable.meta.bases', match: { host, method: 'GET', path: '^/v0/meta/bases$' }, respond: { status: 200, json: { bases: [{ id: 'appFRTMOCK', name: 'frt', permissionLevel: 'create' }] } } },
    { id: 'airtable.records.write', match: { host, method: 'POST|PATCH|PUT', path: '^/v0/[^/]+/[^/]+' }, respond: { status: 200, json: { records: [{ id: 'recFRT{{seq}}', createdTime: '{{now}}', fields: {} }], id: 'recFRT{{seq}}', createdTime: '{{now}}', fields: '{{echo body.fields}}' } } },
    { id: 'airtable.records.delete', match: { host, method: 'DELETE', path: '^/v0/[^/]+/[^/]+' }, respond: { status: 200, json: { records: [{ id: 'recFRT', deleted: true }], deleted: true, id: 'recFRT' } } },
    { id: 'airtable.records.list', match: { host, method: 'GET', path: '^/v0/[^/]+/[^/]+' }, respond: { status: 200, json: { records: [] } } },
  ];
}

export function notionRules(): SinkRule[] {
  const host = 'api.notion.com';
  const schema = { Name: { id: 'title', name: 'Name', type: 'title', title: {} } };
  return [
    // The node simplifies the response by property `type`, so every property needs a typed shape; echoing the request body is not enough.
    { id: 'notion.pages.create', match: { host, method: 'POST', path: '^/v1/pages$' }, respond: { status: 200, json: { object: 'page', id: '{{uuid}}', created_time: '{{now}}', last_edited_time: '{{now}}', archived: false, properties: { Name: { id: 'title', type: 'title', title: [{ type: 'text', text: { content: 'frt', link: null }, plain_text: 'frt', href: null, annotations: {} }] } }, parent: '{{echo body.parent}}', url: 'https://www.notion.so/frt' } } },
    { id: 'notion.pages.update', match: { host, method: 'PATCH', path: '^/v1/(pages|blocks)/' }, respond: { status: 200, json: { object: 'page', id: '{{uuid}}', properties: '{{echo body.properties}}' } } },
    { id: 'notion.query', match: { host, method: 'POST', path: '^/v1/(databases|data_sources)/[^/]+/query$' }, respond: { status: 200, json: { object: 'list', results: [], has_more: false, next_cursor: null } } },
    { id: 'notion.search', match: { host, method: 'POST', path: '^/v1/search$' }, respond: { status: 200, json: { object: 'list', results: [], has_more: false, next_cursor: null } } },
    { id: 'notion.data_source.get', match: { host, method: 'GET', path: '^/v1/(databases|data_sources)/' }, respond: { status: 200, json: { object: 'data_source', id: 'frt-data-source', properties: schema, title: [{ plain_text: 'frt' }], parent: { type: 'database_id', database_id: 'frt-db' } } } },
    { id: 'notion.get', match: { host, method: 'GET', path: '^/v1/' }, respond: { status: 200, json: { object: 'page', id: '{{uuid}}', properties: schema, results: [], has_more: false } } },
  ];
}

export function openAiRules(): SinkRule[] {
  const host = 'api.openai.com';
  return [
    { id: 'openai.responses', match: { host, method: 'POST', path: '^/v1/responses$' }, respond: { status: 200, json: { id: 'resp_frt{{seq}}', object: 'response', created_at: 1700000000, status: 'completed', model: '{{echo body.model}}', output: [{ type: 'message', id: 'msg_frt', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'frt mock reply', annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } } },
    { id: 'openai.chat.completions', match: { host, method: 'POST', path: '^/v1/chat/completions$' }, respond: { status: 200, json: { id: 'chatcmpl-frt{{seq}}', object: 'chat.completion', created: 1700000000, model: '{{echo body.model}}', choices: [{ index: 0, message: { role: 'assistant', content: 'frt mock reply' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } } },
    { id: 'openai.models', match: { host, method: 'GET', path: '^/v1/models' }, respond: { status: 200, json: { object: 'list', data: [{ id: 'gpt-4o-mini', object: 'model' }] } } },
  ];
}

export function geminiRules(): SinkRule[] {
  const host = 'generativelanguage.googleapis.com';
  return [
    { id: 'gemini.generateContent', match: { host, method: 'POST', path: ':(generateContent|streamGenerateContent)' }, respond: { status: 200, json: { candidates: [{ content: { parts: [{ text: 'frt mock reply' }], role: 'model' }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } } } },
    { id: 'gemini.models', match: { host, method: 'GET', path: '^/v1beta/models' }, respond: { status: 200, json: { models: [] } } },
  ];
}

/** Ordered rules for every supported service, followed by the token rule. User stubs go in front, sink and block behind. */
export function serviceRules(ctx: SinkContext = {}): SinkRule[] {
  return [...slackRules(), ...hubspotRules(), ...googleSheetsRules(ctx), ...airtableRules(ctx), ...notionRules(), ...openAiRules(), ...geminiRules(), ...tokenRules()];
}

export function genericSinkRule(): SinkRule {
  return { id: 'generic-sink', match: { method: 'POST|PUT|PATCH|DELETE' }, respond: { status: 200, json: { id: 'frt-{{seq}}', ok: true } } };
}

export function blockRule(): SinkRule {
  return { id: 'block', match: {}, respond: { close: true } };
}
