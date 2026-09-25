import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The app runs on 127.0.0.1 (APP_URL, Supabase redirect URLs). Next dev serves HMR only to localhost unless the
  // origin is listed; without HMR the page never hydrated, forms went out as native POSTs, and the HMR client's
  // periodic full reloads sent them again (seven tokens from one Enter).
  allowedDevOrigins: ['127.0.0.1'],
  // react-pdf loads fonts and yoga at runtime; bundling it breaks both. The PDF route reads the fonts from assets/.
  serverExternalPackages: ['@react-pdf/renderer'],
  outputFileTracingIncludes: { '/runs/[runId]/pdf': ['./assets/fonts/*.ttf'] },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Pages get their Content-Security-Policy with a per-request nonce from proxy.ts (lib/csp.ts). API answers are
      // not HTML and run nothing; a strict policy costs nothing there. Two policies on one page would both apply.
      { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }] },
    ];
  },
};

export default nextConfig;
