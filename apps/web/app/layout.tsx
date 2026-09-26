import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Doto } from 'next/font/google';
import { TestModeBanner } from '@/components/test-mode-banner.tsx';
import './globals.css';

// Every page is rendered per request: the CSP nonce from proxy.ts only reaches scripts rendered with it.
export const dynamic = 'force-dynamic';

// next/font downloads the files at build time and serves them from this origin, so font-src 'self' holds.
const sans = Atkinson_Hyperlegible_Next({ subsets: ['latin', 'latin-ext'], variable: '--font-atkinson', display: 'swap', adjustFontFallback: false });
const mono = Atkinson_Hyperlegible_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-atkinson-mono', display: 'swap', adjustFontFallback: false });
const dot = Doto({ subsets: ['latin'], weight: 'variable', axes: ['ROND'], variable: '--font-doto', display: 'swap', adjustFontFallback: false });

export const metadata: Metadata = {
  title: { default: 'FlowRetest', template: '%s · FlowRetest' },
  description: 'Plans of n8n workflow changes, replayed in a sealed sandbox on your machine.',
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f5f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1216' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${dot.variable}`}>
      <body className="min-h-screen font-sans text-base antialiased">
        <a href="#main" className="skip-link">Skip to content</a>
        <TestModeBanner />
        {children}
      </body>
    </html>
  );
}
