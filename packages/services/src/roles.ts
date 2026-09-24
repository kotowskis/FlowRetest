import type { N8nNode, NodeRole } from '@flowretest/core';

export interface RoleVerdict {
  role: NodeRole;
  note?: string;
}

type OperationTable = Record<string, Record<string, 'read' | 'write'>>;

/** resource -> operation -> role for app nodes whose calls all go through n8n's HTTP helpers. */
const TABLES: Record<string, OperationTable> = {
  'n8n-nodes-base.slack': {
    message: { post: 'write', schedule: 'write', update: 'write', delete: 'write', deleteScheduled: 'write', sendAndWait: 'write', getPermalink: 'read', getManyScheduled: 'read', search: 'read' },
    channel: { create: 'write', archive: 'write', close: 'write', invite: 'write', join: 'write', kick: 'write', leave: 'write', open: 'write', rename: 'write', setPurpose: 'write', setTopic: 'write', unarchive: 'write', get: 'read', getAll: 'read', history: 'read', member: 'read', replies: 'read' },
    file: { upload: 'write', get: 'read', getAll: 'read' },
    reaction: { add: 'write', remove: 'write', get: 'read' },
    star: { add: 'write', delete: 'write', getAll: 'read' },
    user: { get: 'read', getAll: 'read', getProfile: 'read', getPresence: 'read', updateProfile: 'write' },
    userGroup: { create: 'write', enable: 'write', disable: 'write', update: 'write', getAll: 'read' },
  },
  'n8n-nodes-base.hubspot': {
    contact: { upsert: 'write', delete: 'write', get: 'read', getAll: 'read', getRecentlyCreatedUpdated: 'read', search: 'read' },
    company: { create: 'write', update: 'write', delete: 'write', get: 'read', getAll: 'read', getRecentlyCreatedUpdated: 'read', searchByDomain: 'read' },
    deal: { create: 'write', update: 'write', delete: 'write', get: 'read', getAll: 'read', getRecentlyCreated: 'read', getRecentlyModified: 'read', search: 'read' },
    ticket: { create: 'write', update: 'write', delete: 'write', get: 'read', getAll: 'read' },
    engagement: { create: 'write', delete: 'write', get: 'read', getAll: 'read' },
    contactList: { add: 'write', remove: 'write' },
  },
  'n8n-nodes-base.googleSheets': {
    sheet: { append: 'write', appendOrUpdate: 'write', update: 'write', clear: 'write', delete: 'write', remove: 'write', create: 'write', read: 'read' },
    spreadsheet: { create: 'write', delete: 'write', deleteSpreadsheet: 'write', get: 'read' },
  },
  'n8n-nodes-base.airtable': {
    base: { getMany: 'read', getSchema: 'read' },
    record: { create: 'write', update: 'write', upsert: 'write', deleteRecord: 'write', get: 'read', search: 'read' },
  },
  'n8n-nodes-base.notion': {
    page: { create: 'write', archive: 'write', search: 'read' },
    block: { append: 'write', getAll: 'read' },
    database: { get: 'read', getAll: 'read', search: 'read' },
    databasePage: { create: 'write', update: 'write', get: 'read', getAll: 'read' },
    user: { get: 'read', getAll: 'read' },
  },
};

const DEFAULT_RESOURCE: Record<string, string> = {
  'n8n-nodes-base.slack': 'message',
  'n8n-nodes-base.hubspot': 'contact',
  'n8n-nodes-base.googleSheets': 'sheet',
  'n8n-nodes-base.airtable': 'record',
  'n8n-nodes-base.notion': 'page',
};

/** Consulted by the classifier before its built-in rules. Unknown operations are unsupported, never silently reads. */
export function serviceRole(node: N8nNode): RoleVerdict | undefined {
  const table = TABLES[node.type];
  if (!table) return undefined;
  const resource = String(node.parameters.resource ?? DEFAULT_RESOURCE[node.type] ?? '');
  const operation = node.parameters.operation;
  if (typeof operation === 'string' && operation.startsWith('=')) return { role: 'write', note: 'operation is an expression, treated as a write, review' };
  const ops = table[resource];
  const op = typeof operation === 'string' ? operation : Object.keys(ops ?? {})[0];
  const role = ops?.[op ?? ''];
  if (!role) return { role: 'unsupported', note: `no role for ${node.type} ${resource}.${String(op)}` };
  return { role };
}

export const SUPPORTED_SERVICE_TYPES = Object.keys(TABLES);
