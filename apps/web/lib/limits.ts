export type LimitName = 'workspaces' | 'seats' | 'uploads' | 'workspace-over-limit' | 'subscription';

const NAMES: readonly LimitName[] = ['workspaces', 'seats', 'uploads', 'workspace-over-limit', 'subscription'];

/** 53400 with the limit in HINT is what the database raises when a plan limit stops a write (migration 20261214). */
export function planLimitOf(error: { code?: string; hint?: string | null } | null | undefined): LimitName | undefined {
  if (error?.code !== '53400') return undefined;
  return NAMES.find((l) => l === error.hint) ?? 'workspaces';
}
