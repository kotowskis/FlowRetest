/**
 * Zod schemas of every file format FlowRetest reads or writes. JSON Schema
 * files in docs/formaty are generated from these with `npm run schemas`.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const ConfigSchema = z.object({
  schemaVersion: z.literal(1),
  instance: z.object({ url: z.string().url() }),
  engine: z.object({
    image: z.string().default('n8nio/n8n'),
    tag: z.string().min(1),
    timezone: z.string().default('UTC'),
    env: z.record(z.string(), z.string()).optional(),
  }),
  proxy: z.object({ image: z.string().default('flowretest-proxy:dev'), digest: z.string().optional() }),
  normalize: z.object({ ignore: z.array(z.string()).default([]), idSegments: z.array(z.string()).optional() }),
  run: z.object({
    timeoutSeconds: z.number().int().positive().default(120),
    stabilize: z.boolean().default(false),
    executor: z.enum(['batch', 'execute']).optional(),
  }),
});
export type Config = z.infer<typeof ConfigSchema>;

const PairedItem = z.union([z.number(), z.object({ item: z.number(), input: z.number().optional() }), z.array(z.object({ item: z.number(), input: z.number().optional() }))]);

export const RecordedItemSchema = z.object({ json: z.unknown(), pairedItem: PairedItem.optional(), binary: z.unknown().optional() });

export const FixtureSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    instanceHost: z.string().optional(),
    workflowId: z.string(),
    executionId: z.string(),
    workflowVersionId: z.string().optional(),
    startedAt: z.string().optional(),
    mode: z.string().optional(),
    status: z.string().optional(),
  }),
  workflowData: z.unknown().optional(),
  trigger: z.object({ node: z.string(), type: z.string(), typeVersion: z.number(), items: z.array(RecordedItemSchema) }),
  nodes: z.record(
    z.string(),
    z.object({
      type: z.string(),
      typeVersion: z.number(),
      runs: z.array(z.object({ startTime: z.number().optional(), executionTime: z.number().optional(), inputCount: z.number().optional(), outputs: z.array(z.array(RecordedItemSchema)) })),
    }),
  ),
  sizeBytes: z.number().optional(),
  redacted: z.boolean(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

export const RuleSchema = z.object({
  id: z.string(),
  match: z.object({ host: z.string().optional(), method: z.string().optional(), path: z.string().optional() }),
  respond: z.object({
    status: z.number().int().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    json: z.unknown().optional(),
    body: z.string().optional(),
    close: z.boolean().optional(),
  }),
  times: z.number().int().positive().optional(),
});
export const RulesFileSchema = z.object({ schemaVersion: z.literal(1), rules: z.array(RuleSchema) });
export type RulesFile = z.infer<typeof RulesFileSchema>;

export const CaptureRecordSchema = z.object({
  ts: z.number(),
  version: z.string(),
  case: z.string(),
  method: z.string(),
  host: z.string(),
  port: z.number(),
  path: z.string(),
  query: z.record(z.string(), z.string()),
  contentType: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  body: z.string().optional(),
  bodyJson: z.unknown().optional(),
  bodyBytes: z.number(),
  bodySha256: z.string(),
  multipart: z.array(z.object({ name: z.string(), filename: z.string().optional(), contentType: z.string().optional(), size: z.number(), sha256: z.string() })).optional(),
  rule: z.object({ id: z.string(), kind: z.string() }),
  response: z.object({ status: z.union([z.number(), z.literal('close')]) }),
});
export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;

export const NormalizedCallSchema = z.object({
  version: z.string(),
  caseId: z.string(),
  node: z.string(),
  runIndex: z.number(),
  ts: z.number(),
  method: z.string(),
  host: z.string(),
  pathTemplate: z.string(),
  path: z.string(),
  query: z.record(z.string(), z.string()),
  contentType: z.string().optional(),
  body: z.unknown(),
  bodyHash: z.string(),
  multipart: z.array(z.object({ name: z.string(), filename: z.string().optional(), size: z.number(), sha256: z.string() })).optional(),
  rule: z.object({ id: z.string(), kind: z.string() }),
  blocked: z.boolean(),
  key: z.string(),
});

export const PlanEntrySchema = z.object({
  op: z.enum(['=', '~', '+', '-', '!']),
  node: z.string(),
  method: z.string(),
  host: z.string(),
  pathTemplate: z.string(),
  old: NormalizedCallSchema.optional(),
  new: NormalizedCallSchema.optional(),
  fieldDiffs: z.array(z.object({ path: z.string(), old: z.unknown().optional(), new: z.unknown().optional() })),
  flags: z.array(z.string()),
});

export const CaseDiffSchema = z.object({
  caseId: z.string(),
  status: z.enum(['PASS', 'DIFF', 'ERROR', 'BLOCKED', 'SKIPPED']),
  entries: z.array(PlanEntrySchema),
  summary: z.object({ oldCalls: z.number(), newCalls: z.number(), unchanged: z.number(), changed: z.number(), added: z.number(), removed: z.number(), blocked: z.number() }),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export const RunReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  runner: z.string(),
  mode: z.enum(['change', 'upgrade']).optional(),
  workflowId: z.string(),
  workflowName: z.string().optional(),
  engine: z.object({ image: z.string(), digest: z.string().optional() }),
  engines: z.object({ old: z.string(), new: z.string(), digestOld: z.string().optional(), digestNew: z.string().optional() }).optional(),
  old: z.string(),
  new: z.string(),
  status: z.string(),
  cases: z.array(CaseDiffSchema),
  calls: z.record(z.string(), z.object({ old: z.array(NormalizedCallSchema), new: z.array(NormalizedCallSchema), volatile: z.array(z.string()), stable: z.boolean().optional() })),
  coverage: z.object({ writeNodesTotal: z.number(), writeNodesCaptured: z.number(), replayedNodes: z.number(), unsupported: z.array(z.string()) }),
});
export type RunReport = z.infer<typeof RunReportSchema>;

export const BaselineSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string(),
  acceptedAt: z.string(),
  acceptedBy: z.string().optional(),
  message: z.string().optional(),
  workflowVersionId: z.string().optional(),
  engineDigest: z.string().optional(),
  runnerVersion: z.string(),
  volatilePaths: z.array(z.string()),
  calls: z.array(NormalizedCallSchema.omit({ ts: true, version: true, caseId: true })),
});
export type Baseline = z.infer<typeof BaselineSchema>;

export const ALL_SCHEMAS = {
  config: ConfigSchema,
  fixture: FixtureSchema,
  rules: RulesFileSchema,
  capture: CaptureRecordSchema,
  report: RunReportSchema,
  baseline: BaselineSchema,
} as const;

/** Validates and returns a typed value or throws a readable error listing the first issues. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`${what} is not valid: ${issues.join('; ')}`);
}

/** JSON Schema (draft 2020-12) for one of the formats, for docs and editors. */
export function jsonSchemaOf(name: keyof typeof ALL_SCHEMAS): Record<string, unknown> {
  return z.toJSONSchema(ALL_SCHEMAS[name], { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<string, unknown>;
}
