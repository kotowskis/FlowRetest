'use client';

import { useActionState } from 'react';
import { useHydrated } from '@/components/forms.tsx';
import { sendCode, verifyCode, type LoginState } from './actions.ts';

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
        <form action={send} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required autoComplete="email" defaultValue={email} className="w-full rounded-md border border-line px-3 py-2" />
          <button disabled={sending || !hydrated} className="w-full rounded-md bg-accent px-3 py-2 font-medium text-on-accent disabled:opacity-60">{sending ? 'Sending…' : 'Email me a sign-in code'}</button>
        </form>
      ) : (
        <form action={verify} className="space-y-3">
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
