import { OpGlyph } from './ui.tsx';

/**
 * A plan printed on continuous-form paper (globals.css `printout`): the marker of each row sits in its own column
 * right of the perforation, the text after it, every other row on a green bar.
 */
export const OP_MARK: Record<string, { className: string; label: string }> = {
  '~': { className: 'text-diff', label: 'changed' },
  '+': { className: 'text-pass', label: 'added' },
  '-': { className: 'text-error', label: 'removed' },
  '!': { className: 'text-blocked', label: 'blocked' },
  '=': { className: 'text-muted', label: 'unchanged' },
  E: { className: 'text-error', label: 'failed' },
  x: { className: 'text-error', label: 'expectation failed' },
  '?': { className: 'text-diff', label: 'warning' },
};

export function Printout({ children, className = '', label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <div className={`printout ${className}`} role={label ? 'group' : undefined} aria-label={label}>
      <div className="printout-body">{children}</div>
    </div>
  );
}

/** One line of a plan. `mark` is the plan marker (+ ~ - ! = E x ?); without one the row spans the whole width. */
export function PrintoutRow({ mark, children, className = '' }: { mark?: string; children: React.ReactNode; className?: string }) {
  const op = mark ? OP_MARK[mark] : undefined;
  return (
    <div className={`printout-row grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-1 px-2 py-3 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:px-3 ${className}`}>
      <span className={`flex h-6 items-center justify-center text-lg ${op?.className ?? ''}`}>
        {mark ? (
          <>
            <OpGlyph op={mark} />
            <span className="sr-only">{op?.label ?? mark}</span>
          </>
        ) : null}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
