'use client';

import { useActionState } from 'react';
import { useHydrated } from '@/components/forms.tsx';
import { sendCode, signInAsTestAccount, verifyCode, type LoginState } from './actions.ts';

export function LoginForm({ next, linkError }: { next?: string; linkError?: boolean }) {
  const [sent, send, sending] = useActionState(sendCode, { step: 'email', error: linkError ? 'That sign-in link is wrong or expired. Request a new code.' : undefined } as LoginState);
  const [checked, verify, verifying] = useActionState(verifyCode, { step: 'code' } as LoginState);
  const hydrated = useHydrated();
  const step = sent.step === 'code' && checked.step !== 'email' ? 'code' : 'email';
  const email = checked.email ?? sent.email ?? '';
  const error = step === 'code' ? checked.error : sent.error;

  return (
    <div className="space-y-4">
      {step === 'email' ? (
        // Keys: without them React reuses the email input as the hidden one and warns about uncontrolled to controlled.
        <form key="email" action={send} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required autoComplete="email" defaultValue={email} className="w-full rounded-md border border-line px-3 py-2" />
          <button disabled={sending || !hydrated} className="w-full rounded-md bg-accent px-3 py-2 font-medium text-on-accent disabled:opacity-60">{sending ? 'Sending…' : 'Email me a sign-in code'}</button>
        </form>
      ) : (
        <form key="code" action={verify} className="space-y-3">
          <p className="text-sm text-muted">We sent a 6-digit code to <strong className="text-ink">{email}</strong>. You can also open the link in that email.</p>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next ?? ''} />
          <label className="block text-sm font-medium" htmlFor="code">Code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9 ]{6,7}" className="w-full rounded-md border border-line px-3 py-2 font-mono text-lg tracking-[0.3em]" />
          <button disabled={verifying || !hydrated} className="w-full rounded-md bg-accent px-3 py-2 font-medium text-on-accent disabled:opacity-60">{verifying ? 'Checking…' : 'Sign in'}</button>
        </form>
      )}
      {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
    </div>
  );
}

/** Test mode only: one button per seeded account (lib/test-mode.ts); the page renders it only in test mode. */
export function TestAccounts({ accounts, next }: { accounts: ReadonlyArray<{ email: string; role: string }>; next?: string }) {
  const hydrated = useHydrated();
  return (
    <section aria-labelledby="test-accounts" className="mt-8 rounded-md border border-dashed border-diff/60 p-4">
      <h2 id="test-accounts" className="text-sm font-semibold">Test accounts</h2>
      <p className="mt-1 text-xs text-muted">Test mode signs in as seeded people without an email. Codes for any other address go to Mailpit.</p>
      <ul className="mt-3 space-y-2">
        {accounts.map((a) => (
          <li key={a.email}>
            <form action={signInAsTestAccount}>
              <input type="hidden" name="email" value={a.email} />
              <input type="hidden" name="next" value={next ?? ''} />
              <button disabled={!hydrated} className="w-full rounded-md border border-line px-3 py-2 text-left hover:border-ink disabled:opacity-60">
                <span className="block font-mono text-sm">{a.email}</span>
                <span className="block text-xs text-muted">{a.role}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
