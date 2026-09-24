import { FLAG_TEXT, engineSection, renderPlan, type CaseDiff, type PlanEntry, type PlanReport } from '@flowretest/core';
import { StatusBadge } from './ui.tsx';

const OP_STYLE: Record<string, { mark: string; className: string; label: string }> = {
  '~': { mark: '~', className: 'text-diff', label: 'changed' },
  '+': { mark: '+', className: 'text-pass', label: 'added' },
  '-': { mark: '-', className: 'text-error', label: 'removed' },
  '!': { mark: '!', className: 'text-blocked', label: 'blocked' },
  '=': { mark: '=', className: 'text-muted', label: 'unchanged' },
};

/** Values in a redacted report are shapes (`<string 12 #a1b2c3d4>`), numbers, booleans or placeholders. */
function value(v: unknown): string {
  if (v === undefined) return '(absent)';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function Tile({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone ?? ''}`}>{children}</div>
    </div>
  );
}

function Entry({ entry }: { entry: PlanEntry }) {
  const op = OP_STYLE[entry.op] ?? { mark: entry.op, className: '', label: entry.op };
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-sm">
        <span className={`font-bold ${op.className}`} title={op.label} aria-label={op.label}>{op.mark}</span>
        <span className="font-sans font-medium">{entry.node}</span>
        <span className="break-all text-muted">{entry.method} {entry.host}{entry.pathTemplate}</span>
      </div>
      {entry.op === '+' ? <p className="mt-1 ml-6 text-xs text-muted">new in this version</p> : null}
      {entry.op === '-' ? <p className="mt-1 ml-6 text-xs text-muted">no longer sent</p> : null}
      {entry.flags.length > 0 ? (
        <ul className="mt-2 ml-6 flex flex-wrap gap-2">
          {entry.flags.map((f) => (
            <li key={f} className="rounded border border-diff/40 bg-diff/10 px-1.5 py-0.5 text-xs text-diff">{FLAG_TEXT[f] ?? f}</li>
          ))}
        </ul>
      ) : null}
      {entry.fieldDiffs.length > 0 ? (
        <div className="mt-2 ml-6 overflow-x-auto">
          <table className="text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="pr-4 pb-1 font-medium">field</th>
                <th className="pr-4 pb-1 font-medium">old</th>
                <th className="pb-1 font-medium">new</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {entry.fieldDiffs.map((d, i) => (
                <tr key={i} className="align-top">
                  <td className="pr-4 break-all">{d.path}</td>
                  <td className="pr-4 break-all text-error">{value(d.old)}</td>
                  <td className="break-all text-pass">{value(d.new)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}

function CaseCard({ c }: { c: CaseDiff }) {
  const changed = c.entries.filter((e) => e.op !== '=');
  const notes = [...(c.expectationFailures ?? []).map((t) => ({ t, kind: 'expectation' })), ...(c.warnings ?? []).map((t) => ({ t, kind: 'warning' })), ...(c.engineDifferences ?? []).map((t) => ({ t, kind: 'engine' }))];
  return (
    <article className="rounded-md border border-line bg-panel" id={`case-${c.caseId}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="font-mono text-sm font-semibold">case {c.caseId}</h3>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>{c.summary.oldCalls} calls before, {c.summary.newCalls} after</span>
          <StatusBadge status={c.status} />
        </div>
      </header>
      {c.error ? <p className="border-b border-line px-4 py-3 font-mono text-sm break-words text-error">execution failed: {c.error}</p> : null}
      {notes.length > 0 ? (
        <ul className="space-y-1 border-b border-line px-4 py-3 text-sm">
          {notes.map((n, i) => (
            <li key={i}>
              <span className="mr-2 text-xs text-muted uppercase">{n.kind}</span>
              {n.t}
            </li>
          ))}
        </ul>
      ) : null}
      {changed.length > 0 ? <ul className="divide-y divide-line">{changed.map((e, i) => <Entry key={i} entry={e} />)}</ul> : null}
      {c.summary.unchanged > 0 ? <p className="px-4 py-2 text-xs text-muted">= {c.summary.unchanged} unchanged call{c.summary.unchanged === 1 ? '' : 's'}</p> : null}
      {changed.length === 0 && c.summary.unchanged === 0 && !c.error ? <p className="px-4 py-2 text-xs text-muted">no outbound calls</p> : null}
    </article>
  );
}

/** The plan of one uploaded run: the same content as the terminal plan, laid out for reading in a browser. */
export function ReportView({ report }: { report: PlanReport }) {
  const total = report.cases.reduce((acc, c) => ({ changed: acc.changed + c.summary.changed, added: acc.added + c.summary.added, removed: acc.removed + c.summary.removed, blocked: acc.blocked + c.summary.blocked }), { changed: 0, added: 0, removed: 0, blocked: 0 });
  const cov = report.coverage;
  const pct = cov.writeNodesTotal === 0 ? 100 : Math.round((cov.writeNodesCaptured / cov.writeNodesTotal) * 100);
  const engine = engineSection(report);
  const findings = [...(report.static?.findings ?? []), ...(report.static?.diff ?? [])].filter((f) => f.severity !== 'info');
  // Cases that need attention first, then the rest in their own order.
  const rank: Record<string, number> = { ERROR: 0, BLOCKED: 1, SKIPPED: 1, DIFF: 2, PASS: 3 };
  const cases = [...report.cases].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Cases">{report.cases.length}</Tile>
        <Tile label="Changed" tone={total.changed ? 'text-diff' : ''}>{total.changed}</Tile>
        <Tile label="Added" tone={total.added ? 'text-pass' : ''}>{total.added}</Tile>
        <Tile label="Removed" tone={total.removed ? 'text-error' : ''}>{total.removed}</Tile>
        <Tile label="Blocked" tone={total.blocked ? 'text-blocked' : ''}>{total.blocked}</Tile>
        <Tile label="Write coverage">{pct}%</Tile>
      </div>

      <p className="text-sm text-muted">
        {cov.writeNodesCaptured} of {cov.writeNodesTotal} write node{cov.writeNodesTotal === 1 ? '' : 's'} captured · {cov.replayedNodes} node{cov.replayedNodes === 1 ? '' : 's'} replayed from recordings
        {cov.unsupported.length ? ` · unsupported: ${cov.unsupported.join(', ')}` : ''}
        {cov.stubbed?.length ? ` · stubbed: ${cov.stubbed.join(', ')}` : ''} ·{' '}
        {report.sealed ? <span className="text-pass">sandbox sealed, checked before the run</span> : <span className="text-error">sandbox seal not verified</span>}
      </p>

      {engine.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Engine differences</h2>
          <pre className="overflow-x-auto rounded-md border border-line bg-panel p-4 font-mono text-xs">{engine.slice(1).join('\n')}</pre>
        </section>
      ) : null}

      {findings.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Static findings</h2>
          <ul className="divide-y divide-line rounded-md border border-line bg-panel text-sm">
            {findings.map((f, i) => (
              <li key={i} className="px-4 py-2">
                <span className={`mr-2 font-mono text-xs ${f.severity === 'error' ? 'text-error' : 'text-diff'}`}>{f.rule}</span>
                {f.node ? <span className="mr-2 font-medium">{f.node}</span> : null}
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Cases</h2>
        {cases.map((c) => <CaseCard key={c.caseId} c={c} />)}
      </section>

      <details className="rounded-md border border-line bg-panel">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Plan as text (as printed by the CLI)</summary>
        <pre className="overflow-x-auto border-t border-line p-4 font-mono text-xs">{renderPlan(report)}</pre>
      </details>
    </div>
  );
}
