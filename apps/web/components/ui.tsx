import Link from 'next/link';

/**
 * The plan markers drawn as strokes. In most mono faces ~ sits low and thin and reads as -, and here the two mean
 * "changed" and "removed"; drawn, every marker has the same weight and a shape of its own.
 */
const GLYPH: Record<string, React.ReactNode> = {
  '~': <path d="M3.5 13.5c1.8-3.4 3.9-3.6 6.2-1.3s4.6 2.2 6.8-1.4" />,
  '+': <path d="M10 5.5v13M3.5 12h13" />,
  '-': <path d="M3.5 12h13" />,
  '=': <path d="M3.5 9h13M3.5 15h13" />,
  '!': (
    <>
      <path d="M10 4.5v10" />
      <circle cx="10" cy="19" r="0.6" />
    </>
  ),
};

export function OpGlyph({ op, className = '' }: { op: string; className?: string }) {
  const shape = GLYPH[op];
  if (!shape) return <span aria-hidden className={`font-mono font-bold ${className}`}>{op}</span>;
  return (
    <svg aria-hidden viewBox="0 0 20 24" className={`inline-block h-[1em] w-[0.84em] shrink-0 overflow-visible ${className}`} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      {shape}
    </svg>
  );
}

/**
 * Statuses carry the plan's own markers next to the word, so they read without colour: = nothing changed,
 * ~ changed, E failed, ! stopped by the seal, · not run.
 */
const STATUS: Record<string, { mark: string; className: string }> = {
  PASS: { mark: '=', className: 'text-pass border-pass/45 bg-pass/10' },
  DIFF: { mark: '~', className: 'text-diff border-diff/45 bg-diff/10' },
  ERROR: { mark: 'E', className: 'text-error border-error/45 bg-error/10' },
  BLOCKED: { mark: '!', className: 'text-blocked border-blocked/45 bg-blocked/10' },
  SKIPPED: { mark: '·', className: 'text-blocked border-blocked/45 bg-blocked/10' },
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-sm text-muted">no runs</span>;
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-px font-mono text-xs leading-5 font-bold tracking-wide ${s?.className ?? 'border-line text-muted'}`}>
      {s ? <OpGlyph op={s.mark} /> : null}
      {status}
    </span>
  );
}

/** The product mark: the ~ of a changed call in carbon violet, then the name as the CLI prints it. */
export function Wordmark({ href }: { href: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 font-mono text-[0.9375rem] font-bold tracking-tight" aria-label="FlowRetest home">
      <span aria-hidden className="grid size-6 place-items-center rounded-sm bg-accent text-base text-on-accent transition-transform group-hover:-rotate-6">
        <OpGlyph op="~" />
      </span>
      flowretest
    </Link>
  );
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
    <header className="mb-10">
      <nav aria-label="Breadcrumb">
        <ol className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs text-muted">
          {crumbs.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden className="text-line">/</span> : null}
              {c.href ? (
                <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? 'page' : undefined} className="text-ink">{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="min-w-0 text-3xl leading-tight font-bold tracking-tight break-words sm:text-[2.125rem]">{title}</h1>
        {children}
      </div>
    </header>
  );
}

export interface Tab {
  label: string;
  href: string;
  current?: boolean;
}

/** The pages of one organization or workspace, under its header. */
export function SubNav({ label, tabs }: { label: string; tabs: Tab[] }) {
  return (
    <nav aria-label={label} className="-mt-6 mb-10 overflow-x-auto border-b border-line">
      <ul className="flex min-w-max gap-6 text-sm">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={t.current ? 'page' : undefined}
              className={`inline-block py-3 font-semibold ${t.current ? 'text-ink shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-muted hover:text-ink hover:shadow-[inset_0_-2px_0_var(--color-line)]'}`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function OrgNav({ orgId, current }: { orgId: string; current: 'overview' | 'drift' | 'data' | 'billing' }) {
  const base = `/o/${orgId}`;
  return (
    <SubNav
      label="Organization"
      tabs={[
        { label: 'Workspaces and members', href: base, current: current === 'overview' },
        { label: 'Engine drift', href: `${base}/drift`, current: current === 'drift' },
        { label: 'Data and DPA', href: `${base}/data`, current: current === 'data' },
        { label: 'Billing', href: `${base}/billing`, current: current === 'billing' },
      ]}
    />
  );
}

export function WorkspaceNav({ workspaceId, current }: { workspaceId: string; current: 'overview' | 'drift' }) {
  return (
    <SubNav
      label="Workspace"
      tabs={[
        { label: 'Workflows and settings', href: `/w/${workspaceId}`, current: current === 'overview' },
        { label: 'Engine drift', href: `/w/${workspaceId}/drift`, current: current === 'drift' },
      ]}
    />
  );
}

/** A titled part of a page; on wide screens the title and its explanation sit in a left column, like a form. */
export function Section({ title, description, children, id }: { title: string; description?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mb-12 scroll-mt-6 border-t border-line pt-6 [header+&]:border-t-0 [header+&]:pt-0 [nav+&]:border-t-0 [nav+&]:pt-0 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
      <div className="mb-5 lg:mb-0">
        <h2 className="text-lg leading-snug font-bold tracking-tight">{title}</h2>
        {description ? <p className="mt-1.5 text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-4 py-5 text-sm leading-6 text-muted">{children}</p>;
}

/** A message after an action or a redirect; `tone` picks the colour, the text says what happened. */
export function Notice({ tone = 'info', children, role = 'status' }: { tone?: 'ok' | 'warn' | 'error' | 'info'; children: React.ReactNode; role?: 'status' | 'alert' | 'note' }) {
  const style = { ok: 'border-pass/45 bg-pass/10', warn: 'border-diff/45 bg-diff/10', error: 'border-error/45 bg-error/10 text-error', info: 'border-line bg-panel' }[tone];
  return <div role={role} className={`mb-8 rounded-md border px-4 py-3 text-sm leading-6 ${style}`}>{children}</div>;
}

/** Minor units as "79 EUR" or "758.40 EUR"; fixed format, no locale. */
export function money(cents: number, currency = 'eur'): string {
  const amount = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return `${amount} ${currency.toUpperCase()}`;
}

const control = 'min-h-10 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink transition-colors hover:border-muted';
export const inputClass = control;
export const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-colors hover:bg-accent/88 disabled:cursor-not-allowed disabled:opacity-55';
export const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-panel px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-55';
export const quietButtonClass = 'inline-flex min-h-8 items-center rounded-md border border-line px-2.5 text-xs font-semibold text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-55';
/** A list of records in a panel; rows get the green bar on every other line. */
export const listClass = 'record-list';
/** A table of records in a panel that scrolls sideways on narrow screens. */
export const tableWrapClass = 'overflow-x-auto rounded-md border border-line bg-panel';

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
  workflow_version_id?: string | null;
}

/** Acceptance history: who accepted which cases and why, and whether a runner has written the baselines yet. */
export function AcceptanceList({ rows, showRun }: { rows: AcceptanceRow[]; showRun?: boolean }) {
  if (rows.length === 0) return <Empty>No acceptances yet.</Empty>;
  return (
    <ul className={listClass}>
      {rows.map((a) => {
        const partial = a.applied_at && (a.applied_cases?.length ?? 0) < a.case_ids.length;
        return (
          <li key={a.id} className="space-y-1.5 px-4 py-3.5 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-semibold">{a.accepted_by_email || 'unknown'}</span> accepted <span className="font-mono text-xs">case {a.case_ids.join(', ')}</span>
                {a.workflow_version_id ? <span className="text-xs text-muted"> of version <code className="font-mono">{a.workflow_version_id.slice(0, 8)}</code></span> : null}
                {showRun && a.run_id ? (
                  <>
                    {' '}from <Link href={`/runs/${a.run_id}`} className="underline hover:text-accent">this run</Link>
                  </>
                ) : null}
              </span>
              <span className="font-mono text-xs text-muted"><Time value={a.created_at} /></span>
            </div>
            {a.message ? <p className="border-l-2 border-accent/50 pl-3 text-ink">{a.message}</p> : null}
            <p className={`text-xs leading-5 ${a.applied_at ? (partial ? 'text-diff' : 'text-pass') : 'text-muted'}`}>
              {a.applied_at ? (
                <>
                  Baselines written for {a.applied_cases?.length ? `case ${a.applied_cases.join(', ')}` : 'no case'} on <Time value={a.applied_at} />
                  {a.applied_note ? <span className="block whitespace-pre-line text-muted">{a.applied_note}</span> : null}
                </>
              ) : (
                <>Waiting for <code className="font-mono">flowretest pull</code> or <code className="font-mono">sync</code> on the machine with run {a.local_run ? <code className="font-mono">{a.local_run}</code> : '(unknown)'}</>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
