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

/** "n8nio/n8n:2.41.0" -> "2.41.0"; a registry port before the last slash is not a tag separator. */
export function engineTag(image: string | null | undefined): string {
  if (!image) return '?';
  const name = image.slice(image.lastIndexOf('/') + 1);
  const colon = name.indexOf(':');
  return colon >= 0 ? name.slice(colon + 1) : name;
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
