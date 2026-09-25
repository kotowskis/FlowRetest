import type { Tables } from './database.types.ts';

export type Plan = Tables<'plans'>;

/** The lines of a plan card, shared by the public pricing page and the billing page so both say the same thing. */
export function planFeatures(p: Plan): string[] {
  return [
    p.workspaces === null ? 'Unlimited workspaces' : `${p.workspaces} workspace${p.workspaces === 1 ? '' : 's'}`,
    `${p.seats} seats`,
    `Run history kept ${p.retention_days} days`,
    `${p.uploads_per_day.toLocaleString('en-US')} uploads per 24 hours`,
    p.integrations ? 'GitHub checks and Slack' : 'Email notifications only',
    ...(p.pdf_export ? ['PDF record of what each run would send'] : []),
    ...(p.drift_matrix ? ['Engine drift matrix across workspaces'] : []),
  ];
}

/**
 * "n8nio/n8n:2.41.0" -> "2.41.0"; a registry port before the last slash is not a tag separator. An image without a tag
 * is "latest", as Docker reads it; one pinned only by digest shows the digest's start.
 */
export function engineTag(image: string | null | undefined): string {
  if (!image) return '?';
  const name = image.slice(image.lastIndexOf('/') + 1);
  const [ref = '', digest] = name.split('@');
  const colon = ref.indexOf(':');
  if (colon >= 0) return ref.slice(colon + 1);
  return digest ? `@${digest.replace(/^sha256:/, '').slice(0, 12)}` : 'latest';
}

/**
 * One cell per workflow and target tag. The database keeps the latest run per exact image, so
 * `n8nio/n8n:2.41.0` and `docker.n8n.io/n8nio/n8n:2.41.0` are two rows; the matrix shows the newer one.
 */
export function latestPerTag<T extends { workflow_id: string | null; engine_to: string | null; created_at: string | null; id: string | null }>(cells: T[]): T[] {
  const best = new Map<string, T>();
  for (const c of cells) {
    const key = `${c.workflow_id} ${engineTag(c.engine_to)}`;
    const seen = best.get(key);
    const newer = !seen || (c.created_at ?? '') > (seen.created_at ?? '') || ((c.created_at ?? '') === (seen.created_at ?? '') && (c.id ?? '') > (seen.id ?? ''));
    if (newer) best.set(key, c);
  }
  return [...best.values()];
}

/** Newest version first: numeric tags by their numbers, other tags (next, v3-nightly) after them by name. */
export function compareEngineTags(a: string, b: string): number {
  const parse = (t: string) => (/^v?\d+(\.\d+)*$/.test(t) ? t.replace(/^v/, '').split('.').map(Number) : undefined);
  const pa = parse(a);
  const pb = parse(b);
  if (pa && pb) {
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] ?? 0) - (pa[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b);
}
