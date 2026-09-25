import type { Metadata } from 'next';
import './globals.css';

// Every page is rendered per request: the CSP nonce from proxy.ts only reaches scripts rendered with it.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'FlowRetest', template: '%s · FlowRetest' },
  description: 'Plans of n8n workflow changes, replayed in a sealed sandbox on your machine.',
  robots: { index: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
