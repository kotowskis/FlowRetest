import Link from 'next/link';
import { session } from '@/lib/data.ts';
import { Wordmark } from '@/components/ui.tsx';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await session();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Wordmark href="/orgs" />
          <nav aria-label="Account" className="flex min-w-0 items-center gap-2 text-sm">
            <Link href="/account" className="hidden min-w-0 truncate rounded-md px-2.5 py-2 text-muted hover:text-ink sm:inline-block">{user.email}</Link>
            <Link href="/account" className="rounded-md px-2.5 py-2 text-muted hover:text-ink sm:hidden">Account</Link>
            <form action="/auth/signout" method="post">
              <button className="inline-flex min-h-9 items-center rounded-md border border-line px-3 text-sm font-semibold transition-colors hover:border-ink">Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-10 outline-none sm:px-6">{children}</main>
    </div>
  );
}
