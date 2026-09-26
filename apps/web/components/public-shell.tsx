import Link from 'next/link';
import { Wordmark } from './ui.tsx';

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
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Wordmark href="/" />
          <nav aria-label="Main" className="flex items-center gap-1 text-sm font-medium sm:gap-2">
            <Link href="/pricing" className="rounded-md px-2.5 py-2 text-muted hover:text-ink">Pricing</Link>
            <a href={REPOSITORY_URL} className="hidden rounded-md px-2.5 py-2 text-muted hover:text-ink sm:inline-block">Source on GitHub</a>
            <Link href="/login" className="ml-1 rounded-md border border-line bg-panel px-3 py-2 hover:border-ink">Sign in</Link>
          </nav>
        </div>
      </header>
      <div id="main" tabIndex={-1} className="flex-1 outline-none">{children}</div>
      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-muted sm:grid-cols-[1fr_auto] sm:px-6">
          <div className="space-y-2">
            <Wordmark href="/" />
            <p className="max-w-sm leading-6">Regression plans for n8n workflows. The runner is open source under the MIT licence; the hosted history is a paid service.</p>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap content-start gap-x-5 gap-y-2 sm:max-w-xs sm:justify-end">
            {LEGAL_LINKS.map(([href, label]) => (
              <Link key={href} href={href} className="hover:text-ink hover:underline">{label}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
