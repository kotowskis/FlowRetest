/** Role a node plays in a replayed run. */
export type NodeRole = 'trigger' | 'read' | 'write' | 'logic' | 'replace' | 'unsupported';

/** Status of one replayed case. */
export type CaseStatus = 'PASS' | 'DIFF' | 'ERROR' | 'BLOCKED' | 'SKIPPED';

/** Operation marker of one call in the plan. */
export type CallOp = '=' | '~' | '+' | '-' | '!';

/** Exit codes of the CLI, ordered by severity (5 wins over 4, 4 over 2, ...). */
export const EXIT_CODES = {
  PASS: 0,
  DIFF: 1,
  ERROR: 2,
  BLOCKED: 3,
  ENVIRONMENT: 4,
  INTERNAL: 5,
} as const;
