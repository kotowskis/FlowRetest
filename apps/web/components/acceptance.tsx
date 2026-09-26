'use client';

import { useActionState } from 'react';
import type { FormState } from '@/app/(app)/actions.ts';
import { useHydrated } from './forms.tsx';
import { StatusBadge, buttonClass, inputClass } from './ui.tsx';

export interface AcceptableCase {
  caseId: string;
  status: string;
  /** Why the case cannot be accepted here; undefined when it can. */
  blocked?: string;
}

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/** Accepting cases of a run. The decision is stored here; the runner that has the run writes the baselines. */
export function AcceptForm({ action, runId, cases, localRun }: { action: Action; runId: string; cases: AcceptableCase[]; localRun: string | null }) {
  const [state, run, busy] = useActionState(action, {});
  const hydrated = useHydrated();
  const open = cases.filter((c) => !c.blocked);
  return (
    <form action={run} className="space-y-4">
      <input type="hidden" name="runId" value={runId} />
      <fieldset className="space-y-2">
        <legend className="eyebrow mb-3">Cases</legend>
        {cases.map((c) => (
          <label key={c.caseId} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${c.blocked ? 'text-muted' : ''}`}>
            <input type="checkbox" name="case" value={c.caseId} defaultChecked={!c.blocked && c.status === 'DIFF'} disabled={!!c.blocked} />
            <span className="font-mono font-bold">case {c.caseId}</span>
            <StatusBadge status={c.status} />
            {c.blocked ? <span className="text-xs">{c.blocked}</span> : null}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm font-bold">
        Why is this change intended?
        <textarea name="message" maxLength={2000} rows={2} placeholder="Customer id moved to the new CRM field" className={`${inputClass} max-w-2xl font-normal`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy || !hydrated || open.length === 0} className={buttonClass}>{busy ? 'Accepting…' : 'Accept selected cases'}</button>
        {state.ok ? (
          <span role="status" className="text-sm text-pass">
            {state.ok} The next <code className="font-mono">flowretest pull</code> or <code className="font-mono">flowretest sync</code> on the machine with run {localRun ? <code className="font-mono">{localRun}</code> : 'this run'} writes the baselines.
          </span>
        ) : null}
      </div>
      {state.error ? <p role="alert" className="text-sm text-error">{state.error}</p> : null}
    </form>
  );
}
