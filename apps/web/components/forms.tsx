'use client';

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormState } from '@/app/(app)/actions.ts';
import { buttonClass } from './ui.tsx';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

const noop = () => () => {};

/**
 * False during server rendering and before hydration. Submit buttons stay disabled until then: a form sent before
 * hydration is a native POST, and every reload of that page sends it again (one Enter made five tokens).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/** A form bound to a server action; shows the action's error and resets its fields after success. */
export function ActionForm({ action, submit, pending, children, className }: { action: Action; submit: string; pending: string; children: React.ReactNode; className?: string }) {
  const [state, run, busy] = useActionState(action, {});
  const hydrated = useHydrated();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.done) ref.current?.reset();
  }, [state.done]);
  return (
    <form ref={ref} action={run} className={className ?? 'flex flex-wrap items-end gap-3'}>
      {children}
      <button disabled={busy || !hydrated} className={buttonClass}>{busy ? pending : submit}</button>
      {state.error ? <p role="alert" className="w-full text-sm text-error">{state.error}</p> : null}
      {state.ok && !state.error ? <p role="status" className="w-full text-sm text-pass">{state.ok}</p> : null}
    </form>
  );
}

/** Plan buttons of one plan card: monthly and yearly, each a submit of the same form. */
export function PlanChoice({ action, orgId, plan, options }: { action: Action; orgId: string; plan: string; options: Array<{ interval: 'month' | 'year'; label: string; current: boolean }> }) {
  const [state, run, busy] = useActionState(action, {});
  const hydrated = useHydrated();
  return (
    <form action={run} className="flex flex-col gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="plan" value={plan} />
      {options.map((o) => (
        <button key={o.interval} name="interval" value={o.interval} disabled={busy || !hydrated || o.current} className={o.current ? 'rounded-md border border-line px-3 py-2 text-sm text-muted' : buttonClass}>
          {o.current ? `Current plan, billed ${o.interval === 'month' ? 'monthly' : 'yearly'}` : busy ? 'Opening Stripe…' : o.label}
        </button>
      ))}
      {state.error ? <p role="alert" className="text-sm text-error">{state.error}</p> : null}
      {state.ok ? <p role="status" className="text-sm text-pass">{state.ok}</p> : null}
    </form>
  );
}

/** Creates a workspace token and shows it once, with the commands to use it. */
export function TokenForm({ action, workspaceId, appUrl }: { action: Action; workspaceId: string; appUrl: string }) {
  const [state, run, busy] = useActionState(action, {});
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <form action={run} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <label className="flex flex-col gap-1 text-sm">
          Token name
          <input name="name" required maxLength={100} placeholder="GitHub Actions" className="rounded-md border border-line px-3 py-2 text-sm" />
        </label>
        <button disabled={busy || !hydrated} className={buttonClass}>{busy ? 'Creating…' : 'Create token'}</button>
        {state.error ? <p role="alert" className="w-full text-sm text-error">{state.error}</p> : null}
      </form>
      {state.token ? (
        <div className="rounded-md border border-pass/40 bg-pass/10 p-4 text-sm">
          <p className="font-medium">Copy the token now. It is not shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-panel px-2 py-1 font-mono text-xs break-all">{state.token}</code>
            <button
              type="button"
              className="rounded-md border border-line px-2 py-1 text-xs"
              onClick={() => {
                void navigator.clipboard.writeText(state.token ?? '').then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-3 text-muted">Store it as a CI secret or in <code className="font-mono">.flowretest/secrets.env</code>, then:</p>
          <pre className="mt-2 overflow-x-auto rounded bg-panel p-3 font-mono text-xs">{`FLOWRETEST_TOKEN=${state.token.slice(0, 8)}… \\\n  npx flowretest run --workflow <id> --new <file> --upload --url ${appUrl}`}</pre>
        </div>
      ) : null}
    </div>
  );
}
