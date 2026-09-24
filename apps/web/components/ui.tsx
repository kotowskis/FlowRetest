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
