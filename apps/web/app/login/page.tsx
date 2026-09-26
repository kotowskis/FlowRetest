import type { Metadata } from 'next';
import Link from 'next/link';
import { TEST_ACCOUNTS, testMode } from '@/lib/test-mode.ts';
import { Wordmark } from '@/components/ui.tsx';
import { LoginForm, TestAccounts } from './login-form.tsx';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
        <Wordmark href="/" />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pt-6 pb-16 outline-none">
        <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-3 leading-7 text-muted">
          Plans uploaded by <code className="font-mono text-ink">flowretest upload</code> for your team. Only redacted reports reach this service; fixtures and full reports stay on your machine.
        </p>
        <div className="mt-8 rounded-md border border-line bg-panel p-5 sm:p-6">
          <LoginForm next={next} linkError={error === 'link'} />
        </div>
        {error === 'test-account' ? <p role="alert" className="mt-4 text-sm text-error">That test account is missing from the database. Seed it again with <code className="font-mono">npm run test-mode -- --reset</code>.</p> : null}
        {testMode() ? <TestAccounts accounts={TEST_ACCOUNTS} next={next} /> : null}
        <p className="mt-8 text-sm text-muted">
          New here? See <Link href="/pricing" className="underline hover:text-ink">plans and prices</Link>. The Free plan needs no card.
        </p>
        <p className="mt-2 text-xs leading-5 text-muted">
          Signing in creates an account under the <Link href="/legal/privacy" className="underline hover:text-ink">privacy notice</Link>. The owner of an organization accepts the <Link href="/legal/terms" className="underline hover:text-ink">Terms of Service</Link> when creating it.
        </p>
      </main>
    </div>
  );
}
