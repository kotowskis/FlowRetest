/**
 * Content Security Policy of the pages. Scripts run only with the nonce proxy.ts makes for each request (Next adds it
 * to its own scripts during server rendering), so an injected inline script does not run; 'strict-dynamic' lets
 * those scripts load the chunks they need. Styles keep 'unsafe-inline' for the style attributes React writes.
 */
export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV === 'development'): string {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
