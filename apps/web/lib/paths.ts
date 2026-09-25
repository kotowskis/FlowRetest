const BASE = 'http://flowretest.invalid';

/**
 * A post-login target from a query string: only a path of this app, never another host. The value is resolved the way
 * a browser would resolve it (`/\t/evil.com` and `/\evil.com` are other hosts to a browser) and kept only when it
 * stays on the same origin; control characters and backslashes are refused outright.
 */
export function safeNext(value: unknown): string {
  const next = typeof value === 'string' ? value : '';
  const control = [...next].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
  if (!next.startsWith('/') || control || next.includes('\\')) return '/orgs';
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return '/orgs';
  }
  if (url.origin !== BASE || url.pathname.startsWith('//')) return '/orgs';
  return `${url.pathname}${url.search}${url.hash}`;
}
