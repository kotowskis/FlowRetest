import type { Metadata } from 'next';
import Link from 'next/link';
import { TEST_ACCOUNTS, testMode } from '@/lib/test-mode.ts';
import { LoginForm, TestAccounts } from './login-form.tsx';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <p className="font-mono text-sm text-muted">flowretest</p>
      <h1 className="mt-1 mb-2 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-muted">Plans uploaded by <code className="font-mono">flowretest upload</code> for your team. Only redacted reports reach this service; fixtures and full reports stay on your machine.</p>
      <LoginForm next={next} linkError={error === 'link'} />
      {error === 'test-account' ? <p role="alert" className="mt-4 text-sm text-error">That test account is missing from the database. Seed it again with <code className="font-mono">npm run test-mode -- --reset</code>.</p> : null}
      {testMode() ? <TestAccounts accounts={TEST_ACCOUNTS} next={next} /> : null}
      <p className="mt-8 text-xs text-muted">
        New here? <Link href="/pricing" className="underline">Plans and prices</Link>. The Free plan needs no card.
      </p>
      <p className="mt-2 text-xs text-muted">
        Signing in creates an account under the <Link href="/legal/privacy" className="underline">privacy notice</Link>. The owner of an organization accepts the <Link href="/legal/terms" className="underline">Terms of Service</Link> when creating it.
      </p>
    </main>
  );
}
