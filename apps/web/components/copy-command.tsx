'use client';

import { useState } from 'react';
import { useHydrated } from './forms.tsx';

/** A shell command with a copy button; before hydration the button is hidden and the command stays selectable. */
export function CopyCommand({ command, className = '' }: { command: string; className?: string }) {
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);
  return (
    <div className={`flex min-h-10 max-w-full items-center rounded-md border border-line bg-panel font-mono text-sm ${className}`}>
      <code className="min-w-0 flex-1 px-3 py-2 leading-6 [overflow-wrap:anywhere]">
        <span aria-hidden className="mr-2 text-muted select-none">$</span>
        {command}
      </code>
      {hydrated ? (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="shrink-0 self-stretch border-l border-line px-3 font-sans text-xs font-semibold text-muted hover:text-ink"
        >
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      ) : null}
    </div>
  );
}
