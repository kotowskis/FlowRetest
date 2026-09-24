/** A post-login target from a query string: only local app paths, never `//host`, `/\host` or a full URL. */
export function safeNext(value: unknown): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/orgs';
}
