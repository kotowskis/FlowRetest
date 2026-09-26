import { FLAG_TEXT, engineSection, renderPlan, type CaseDiff, type PlanEntry, type PlanReport } from '@flowretest/core';
import { StatusBadge } from './ui.tsx';
import { Printout, PrintoutRow } from './printout.tsx';

/** Values in a redacted report are shapes (`<string 12 #a1b2c3d4>`), numbers, booleans or placeholders. */
function value(v: unknown): string {
  if (v === undefined) return '(absent)';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function Entry({ entry }: { entry: PlanEntry }) {
  return (
    <PrintoutRow mark={entry.op}>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 leading-6">
        <span className="font-bold">{entry.node}</span>
        <span className="font-mono text-sm break-all text-muted">
          {entry.method} {entry.host}
          {entry.pathTemplate}
        </span>
      </p>
      {entry.op === '+' ? <p className="mt-0.5 text-sm text-muted">New in this version</p> : null}
      {entry.op === '-' ? <p className="mt-0.5 text-sm text-muted">No longer sent</p> : null}
      {entry.flags.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {entry.flags.map((f) => (
            <li key={f} className="rounded-sm border border-diff/45 bg-diff/10 px-1.5 font-mono text-xs leading-5 text-diff">! {FLAG_TEXT[f] ?? f}</li>
          ))}
        </ul>
      ) : null}
      {entry.fieldDiffs.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="eyebrow pr-4 pb-1.5 font-normal">Field</th>
                <th scope="col" className="eyebrow pr-4 pb-1.5 font-normal">Before</th>
                <th scope="col" className="eyebrow pb-1.5 font-normal">After</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {entry.fieldDiffs.map((d, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-4 break-all">{d.path}</td>
                  <td className="py-1 pr-4 break-all text-error"><del className="no-underline">{value(d.old)}</del></td>
                  <td className="py-1 break-all text-pass"><ins className="no-underline">{value(d.new)}</ins></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </PrintoutRow>
  );
}

function CaseSheet({ c }: { c: CaseDiff }) {
  const changed = c.entries.filter((e) => e.op !== '=');
  const notes: Array<{ mark: string; kind: string; text: string }> = [
    ...(c.expectationFailures ?? []).map((text) => ({ mark: 'x', kind: 'Expectation', text })),
    ...(c.warnings ?? []).map((text) => ({ mark: '?', kind: 'Warning', text })),
    ...(c.engineDifferences ?? []).map((text) => ({ mark: '?', kind: 'Engine', text })),
  ];
  return (
    <article id={`case-${c.caseId}`} aria-labelledby={`case-${c.caseId}-title`} className="scroll-mt-6">
      <Printout>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-line px-3 py-3 sm:px-4">
          <h3 id={`case-${c.caseId}-title`} className="font-mono text-sm font-bold">case {c.caseId}</h3>
          <div className="flex items-center gap-3 font-mono text-xs text-muted">
            <span>{c.summary.oldCalls} calls before, {c.summary.newCalls} after</span>
            <StatusBadge status={c.status} />
          </div>
        </header>
        {c.error ? (
          <PrintoutRow mark="E">
            <p className="font-mono text-sm break-words text-error">execution failed: {c.error}</p>
          </PrintoutRow>
        ) : null}
        {notes.map((n, i) => (
          <PrintoutRow key={i} mark={n.mark}>
            <p className="text-sm leading-6">
              <span className="eyebrow mr-2">{n.kind}</span>
              {n.text}
            </p>
          </PrintoutRow>
        ))}
        {changed.map((e, i) => <Entry key={i} entry={e} />)}
        {c.summary.unchanged > 0 ? (
          <PrintoutRow mark="=">
            <p className="font-mono text-sm leading-6 text-muted">{c.summary.unchanged} unchanged call{c.summary.unchanged === 1 ? '' : 's'}</p>
          </PrintoutRow>
        ) : null}
        {changed.length === 0 && c.summary.unchanged === 0 && !c.error ? (
          <PrintoutRow>
            <p className="font-mono text-sm text-muted">No outbound calls</p>
          </PrintoutRow>
        ) : null}
      </Printout>
    </article>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return <span className={n > 0 ? `font-bold ${tone}` : 'text-muted'}>{n} {label}</span>;
}

/** The plan of one uploaded run: the same content as the terminal plan, laid out for reading in a browser. */
export function ReportView({ report }: { report: PlanReport }) {
  const total = report.cases.reduce(
    (acc, c) => ({ oldCalls: acc.oldCalls + c.summary.oldCalls, newCalls: acc.newCalls + c.summary.newCalls, changed: acc.changed + c.summary.changed, added: acc.added + c.summary.added, removed: acc.removed + c.summary.removed, blocked: acc.blocked + c.summary.blocked }),
    { oldCalls: 0, newCalls: 0, changed: 0, added: 0, removed: 0, blocked: 0 },
  );
  const cov = report.coverage;
  const pct = cov.writeNodesTotal === 0 ? 100 : Math.round((cov.writeNodesCaptured / cov.writeNodesTotal) * 100);
  const engine = engineSection(report);
  const findings = [...(report.static?.findings ?? []), ...(report.static?.diff ?? [])].filter((f) => f.severity !== 'info');
  // Cases that need attention first, then the rest in their own order.
  const rank: Record<string, number> = { ERROR: 0, BLOCKED: 1, SKIPPED: 1, DIFF: 2, PASS: 3 };
  const cases = [...report.cases].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));

  return (
    <div className="space-y-10">
      <section aria-label="Summary" className="grid gap-6 rounded-md border border-line bg-panel p-5 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-10">
        <div className="min-w-0">
          <p className="font-mono text-[0.9375rem] leading-7">
            <span className="font-bold">Plan:</span> {total.newCalls} call{total.newCalls === 1 ? '' : 's'} in {report.cases.length} case{report.cases.length === 1 ? '' : 's'} (old version: {total.oldCalls}).{' '}
            <Count n={total.changed} label="changed" tone="text-diff" />, <Count n={total.added} label="added" tone="text-pass" />, <Count n={total.removed} label="removed" tone="text-error" />, <Count n={total.blocked} label="blocked" tone="text-blocked" />.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted">
            {cov.replayedNodes} node{cov.replayedNodes === 1 ? '' : 's'} replayed from recordings
            {cov.unsupported.length ? ` · unsupported: ${cov.unsupported.join(', ')}` : ''}
            {cov.stubbed?.length ? ` · stubbed: ${cov.stubbed.join(', ')}` : ''} ·{' '}
            {report.sealed ? <span className="font-semibold text-pass">sandbox sealed, checked before the run</span> : <span className="font-semibold text-error">sandbox seal not verified</span>}
          </p>
        </div>
        <div>
          <p className="flex items-baseline justify-between gap-2">
            <span className="eyebrow">Write coverage</span>
            <span className={`font-mono text-lg font-bold ${pct < 80 ? 'text-diff' : ''}`}>{pct}%</span>
          </p>
          {/* One segment per write node: filled when its requests were captured. */}
          <div role="img" aria-label={`${cov.writeNodesCaptured} of ${cov.writeNodesTotal} write nodes captured`} className="mt-2 flex h-2.5 gap-0.5">
            {cov.writeNodesTotal === 0 ? (
              <span className="flex-1 rounded-sm border border-dashed border-line" />
            ) : (
              Array.from({ length: Math.min(cov.writeNodesTotal, 40) }, (_, i) => (
                <span key={i} className={`flex-1 rounded-sm ${i < Math.round((cov.writeNodesCaptured / cov.writeNodesTotal) * Math.min(cov.writeNodesTotal, 40)) ? 'bg-ink' : 'bg-line'}`} />
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
            {cov.writeNodesCaptured} of {cov.writeNodesTotal} write node{cov.writeNodesTotal === 1 ? '' : 's'} captured
          </p>
        </div>
      </section>

      {engine.length > 0 ? (
        <section aria-labelledby="engine">
          <h2 id="engine" className="mb-3 text-lg font-bold tracking-tight">Engine differences</h2>
          <pre className="overflow-x-auto rounded-md border border-line bg-panel p-4 font-mono text-xs leading-5">{engine.slice(1).join('\n')}</pre>
        </section>
      ) : null}

      {findings.length > 0 ? (
        <section aria-labelledby="findings">
          <h2 id="findings" className="mb-3 text-lg font-bold tracking-tight">Static findings</h2>
          <ul className="overflow-hidden rounded-md border border-line bg-panel text-sm [&>li:nth-child(even)]:bg-band">
            {findings.map((f, i) => (
              <li key={i} className="px-4 py-2.5 leading-6">
                <span className={`mr-2 font-mono text-xs font-bold ${f.severity === 'error' ? 'text-error' : 'text-diff'}`}>{f.rule}</span>
                {f.node ? <span className="mr-2 font-bold">{f.node}</span> : null}
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="cases" className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cases" className="text-lg font-bold tracking-tight">Cases</h2>
          <p className="text-sm text-muted">Failed and blocked cases first</p>
        </div>
        {cases.map((c) => <CaseSheet key={c.caseId} c={c} />)}
      </section>

      <details className="group rounded-md border border-line bg-panel">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
          Plan as text, as printed by the CLI
          <span aria-hidden className="font-mono text-muted transition-transform group-open:rotate-90">›</span>
        </summary>
        <pre className="overflow-x-auto border-t border-line p-4 font-mono text-xs leading-5">{renderPlan(report)}</pre>
      </details>
    </div>
  );
}
