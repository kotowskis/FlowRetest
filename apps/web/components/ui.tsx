import Link from 'next/link';

const STATUS_STYLE: Record<string, string> = {
  PASS: 'text-pass border-pass/40 bg-pass/10',
  DIFF: 'text-diff border-diff/40 bg-diff/10',
  ERROR: 'text-error border-error/40 bg-error/10',
  BLOCKED: 'text-blocked border-blocked/40 bg-blocked/10',
  SKIPPED: 'text-blocked border-blocked/40 bg-blocked/10',
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-sm text-muted">no runs</span>;
  return <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-xs font-semibold ${STATUS_STYLE[status] ?? 'border-line text-muted'}`}>{status}</span>;
}

/** Times in UTC with a fixed format: the server renders them, so they must not depend on the viewer's locale. */
export function Time({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">never</span>;
  const iso = new Date(value).toISOString();
  return <time dateTime={iso} title={iso}>{iso.slice(0, 16).replace('T', ' ')} UTC</time>;
}

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({ crumbs, title, children }: { crumbs: Crumb[]; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-8">
      <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap gap-1 text-sm text-muted">
        {crumbs.map((c, i) => (
          <span key={i} className="flex gap-1">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {c.href ? <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link> : <span>{c.label}</span>}
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold break-words">{title}</h1>
        {children}
      </div>
    </header>
  );
}

export function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-4 py-6 text-sm text-muted">{children}</p>;
}

export const inputClass = 'rounded-md border border-line px-3 py-2 text-sm';
export const buttonClass = 'rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent disabled:opacity-60';
export const quietButtonClass = 'rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink';

export interface AcceptanceRow {
  id: string;
  created_at: string;
  accepted_by_email: string;
  case_ids: string[];
  message: string | null;
  applied_at: string | null;
  applied_cases: string[] | null;
  applied_note: string | null;
  local_run: string | null;
  run_id: string | null;
}

/** Acceptance history: who accepted which cases and why, and whether a runner has written the baselines yet. */
export function AcceptanceList({ rows, showRun }: { rows: AcceptanceRow[]; showRun?: boolean }) {
  if (rows.length === 0) return <Empty>No acceptances yet.</Empty>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line bg-panel">
      {rows.map((a) => {
        const partial = a.applied_at && (a.applied_cases?.length ?? 0) < a.case_ids.length;
        return (
          <li key={a.id} className="space-y-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-medium">{a.accepted_by_email || 'unknown'}</span> accepted <span className="font-mono text-xs">case {a.case_ids.join(', ')}</span>
                {showRun && a.run_id ? (
                  <>
                    {' '}from <Link href={`/runs/${a.run_id}`} className="hover:underline">this run</Link>
                  </>
                ) : null}
              </span>
              <span className="text-xs text-muted"><Time value={a.created_at} /></span>
            </div>
            {a.message ? <p className="text-muted">“{a.message}”</p> : null}
            <p className={`text-xs ${a.applied_at ? (partial ? 'text-diff' : 'text-pass') : 'text-muted'}`}>
              {a.applied_at ? (
                <>
                  baselines written for {a.applied_cases?.length ? `case ${a.applied_cases.join(', ')}` : 'no case'} on <Time value={a.applied_at} />
                  {a.applied_note ? <span className="block whitespace-pre-line text-muted">{a.applied_note}</span> : null}
                </>
              ) : (
                <>waiting for <code className="font-mono">flowretest pull</code> or <code className="font-mono">sync</code> on the machine with run {a.local_run ? <code className="font-mono">{a.local_run}</code> : '(unknown)'}</>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
