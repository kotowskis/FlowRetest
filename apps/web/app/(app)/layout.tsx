import Link from 'next/link';
import { session } from '@/lib/data.ts';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await session();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/orgs" className="font-mono text-sm font-semibold">flowretest</Link>
          <div className="flex items-center gap-3 text-sm text-muted">
            <Link href="/account" className="hidden truncate hover:text-ink sm:inline">{user.email}</Link>
            <Link href="/account" className="hover:text-ink sm:hidden">Account</Link>
            <form action="/auth/signout" method="post">
              <button className="rounded-md border border-line px-2 py-1 text-xs hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
