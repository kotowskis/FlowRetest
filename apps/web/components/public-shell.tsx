import Link from 'next/link';

/** Repository of the open source runner, as in packages/cli/package.json. */
export const REPOSITORY_URL = 'https://github.com/skynappse/flowretest';

const LEGAL_LINKS: Array<[string, string]> = [
  ['/legal/terms', 'Terms'],
  ['/legal/privacy', 'Privacy'],
  ['/legal/dpa', 'DPA'],
  ['/legal/subprocessors', 'Sub-processors'],
  ['/legal/retention', 'Data retention'],
];

/** Header and footer of the pages people see before signing in: home, pricing, legal. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="font-mono text-sm font-semibold">flowretest</Link>
          <nav className="flex items-center gap-4 text-sm text-muted">
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <a href={REPOSITORY_URL} className="hidden hover:text-ink sm:inline">GitHub</a>
            <Link href="/login" className="rounded-md border border-line px-2 py-1 text-xs hover:text-ink">Sign in</Link>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-xs text-muted">
          <span>FlowRetest for n8n. The runner is MIT licensed.</span>
          <nav className="flex flex-wrap gap-x-4 gap-y-2">
            {LEGAL_LINKS.map(([href, label]) => (
              <Link key={href} href={href} className="hover:text-ink hover:underline">{label}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
