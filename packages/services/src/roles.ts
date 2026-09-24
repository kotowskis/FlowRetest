import type { N8nNode, NodeRole } from '@flowretest/core';

export interface RoleVerdict {
  role: NodeRole;
  note?: string;
}

type OperationTable = Record<string, Record<string, 'read' | 'write'>>;

/**
 * resource -> operation -> role for app nodes whose calls all go through n8n's HTTP helpers. Operation lists come
 * from the node descriptions in n8nio/n8n:2.40.5, all versions of each node merged.
 */
const TABLES: Record<string, OperationTable> = {
  'n8n-nodes-base.slack': {
    message: { post: 'write', postEphemeral: 'write', schedule: 'write', update: 'write', delete: 'write', deleteScheduled: 'write', sendAndWait: 'write', getPermalink: 'read', getManyScheduled: 'read', search: 'read' },
    channel: { create: 'write', archive: 'write', close: 'write', invite: 'write', join: 'write', kick: 'write', leave: 'write', open: 'write', rename: 'write', setPurpose: 'write', setTopic: 'write', unarchive: 'write', get: 'read', getAll: 'read', history: 'read', member: 'read', replies: 'read' },
    file: { upload: 'write', get: 'read', getAll: 'read' },
    reaction: { add: 'write', remove: 'write', get: 'read' },
    star: { add: 'write', delete: 'write', getAll: 'read' },
    user: { info: 'read', getAll: 'read', getProfile: 'read', getPresence: 'read', lookupByEmail: 'read', updateProfile: 'write' },
    userGroup: { create: 'write', enable: 'write', disable: 'write', update: 'write', updateUsers: 'write', getAll: 'read', getUsers: 'read' },
    userProfile: { get: 'read', update: 'write' },
  },
  'n8n-nodes-base.hubspot': {
    contact: { upsert: 'write', delete: 'write', get: 'read', getAll: 'read', getRecentlyCreatedUpdated: 'read', search: 'read' },
    company: { create: 'write', update: 'write', delete: 'write', get: 'read', getAll: 'read', getRecentlyCreated: 'read', getRecentlyModified: 'read', getRecentlyCreatedUpdated: 'read', searchByDomain: 'read' },
    deal: { create: 'write', update: 'write', delete: 'write', get: 'read', getAll: 'read', getRecentlyCreated: 'read', getRecentlyModified: 'read', getRecentlyCreatedUpdated: 'read', search: 'read' },
    ticket: { create: 'write', update: 'write', delete: 'write', get: 'read', getAll: 'read' },
    engagement: { create: 'write', delete: 'write', get: 'read', getAll: 'read' },
    contactList: { add: 'write', remove: 'write' },
    form: { getFields: 'read', submit: 'write' },
  },
  'n8n-nodes-base.googleSheets': {
    sheet: { append: 'write', appendOrUpdate: 'write', upsert: 'write', update: 'write', clear: 'write', delete: 'write', remove: 'write', create: 'write', read: 'read', lookup: 'read' },
    spreadsheet: { create: 'write', delete: 'write', deleteSpreadsheet: 'write', get: 'read' },
  },
  'n8n-nodes-base.airtable': {
    base: { getMany: 'read', getSchema: 'read' },
    record: { create: 'write', update: 'write', upsert: 'write', deleteRecord: 'write', get: 'read', search: 'read' },
    // Airtable v1 has no resource parameter.
    '': { append: 'write', update: 'write', delete: 'write', list: 'read', read: 'read' },
  },
  // Database nodes: reads are replayed from the recording like any node; writes cannot be captured over HTTP.
  'n8n-nodes-base.postgres': { database: { select: 'read', executeQuery: 'write', insert: 'write', update: 'write', upsert: 'write', deleteTable: 'write' } },
  'n8n-nodes-base.mySql': { database: { select: 'read', executeQuery: 'write', insert: 'write', update: 'write', upsert: 'write', deleteTable: 'write' } },
  'n8n-nodes-base.notion': {
    page: { create: 'write', archive: 'write', updateMarkdown: 'write', get: 'read', getMarkdown: 'read', search: 'read' },
    block: { append: 'write', getAll: 'read', getMarkdown: 'read' },
    database: { get: 'read', getAll: 'read', search: 'read' },
    dataSource: { get: 'read', search: 'read' },
    databasePage: { create: 'write', update: 'write', get: 'read', getAll: 'read' },
    user: { get: 'read', getAll: 'read' },
  },
};

/**
 * n8n leaves parameters equal to their default out of the saved workflow, so a missing resource or operation means
 * the default of that node version (n8nio/n8n:2.40.5), never the first entry of the table: Postgres defaults to
 * insert, Google Sheets to read, Airtable to get.
 */
function defaultResource(node: N8nNode): string {
  switch (node.type) {
    case 'n8n-nodes-base.hubspot':
      return node.typeVersion < 2 ? 'deal' : 'contact';
    case 'n8n-nodes-base.airtable':
      return node.typeVersion < 2 ? '' : 'record';
    case 'n8n-nodes-base.slack':
      return 'message';
    case 'n8n-nodes-base.googleSheets':
      return 'sheet';
    case 'n8n-nodes-base.notion':
      return 'page';
    default:
      return 'database';
  }
}

const DEFAULT_OPERATION: Record<string, Record<string, string>> = {
  'n8n-nodes-base.slack': { message: 'post', channel: 'create', file: 'upload', reaction: 'add', star: 'add', user: 'info', userGroup: 'create', userProfile: 'get' },
  'n8n-nodes-base.hubspot': { contact: 'upsert', company: 'create', deal: 'create', engagement: 'create', ticket: 'create', contactList: 'add', form: 'getFields' },
  'n8n-nodes-base.googleSheets': { sheet: 'read', spreadsheet: 'create' },
  'n8n-nodes-base.airtable': { record: 'get', base: 'getMany', '': 'read' },
  'n8n-nodes-base.postgres': { database: 'insert' },
  'n8n-nodes-base.mySql': { database: 'insert' },
  'n8n-nodes-base.notion': { page: 'create', block: 'append', database: 'get', dataSource: 'get', databasePage: 'create', user: 'get' },
};

/** Consulted by the classifier before its built-in rules. Unknown operations are unsupported, never silently reads. */
export function serviceRole(node: N8nNode): RoleVerdict | undefined {
  const table = TABLES[node.type];
  if (!table) return undefined;
  const resource = typeof node.parameters.resource === 'string' ? node.parameters.resource : defaultResource(node);
  const operation = node.parameters.operation;
  if (resource.startsWith('=')) return { role: 'write', note: 'resource is an expression, treated as a write, review' };
  if (typeof operation === 'string' && operation.startsWith('=')) return { role: 'write', note: 'operation is an expression, treated as a write, review' };
  const op = typeof operation === 'string' ? operation : DEFAULT_OPERATION[node.type]?.[resource];
  const role = table[resource]?.[op ?? ''];
  if (!role) return { role: 'unsupported', note: `no role for ${node.type} ${resource || '(no resource)'}.${String(op)}` };
  if (role === 'write' && NON_HTTP_TYPES.has(node.type)) return { role: 'unsupported', note: `database write (${String(op)}) does not go over HTTP and cannot be captured; case skipped` };
  return { role };
}

/** Nodes whose writes bypass HTTP; their reads still replay from recordings. */
const NON_HTTP_TYPES = new Set(['n8n-nodes-base.postgres', 'n8n-nodes-base.mySql']);

export const SUPPORTED_SERVICE_TYPES = Object.keys(TABLES);
