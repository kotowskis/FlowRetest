import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PlanReport } from '@flowretest/core';
import { getRunPair } from '@/lib/data.ts';
import { compareRuns, type CaseCounts } from '@/lib/compare-runs.ts';
import { OP_LABEL } from '@/lib/run-record.ts';
import { Empty, PageHeader, Section, StatusBadge, Time } from '@/components/ui.tsx';

export const metadata: Metadata = { title: 'Compare runs' };

const numbers = (c: CaseCounts | undefined) => (c ? [c.changed && `${c.changed} changed`, c.added && `${c.added} added`, c.removed && `${c.removed} removed`, c.blocked && `${c.blocked} blocked`].filter(Boolean).join(', ') || 'no call changes' : '');
const op = (symbol: string | undefined) => (symbol ? `${symbol} ${OP_LABEL[symbol] ?? ''}` : 'not called');

export default async function ComparePage({ params, searchParams }: { params: Promise<{ workspaceId: string; workflowId: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  const { workspaceId, workflowId } = await params;
  const { a, b } = await searchParams;
  if (!a || !b) notFound();
  const { workflow, workspace, org, runs, before, after } = await getRunPair(workflowId, a, b);
  if (workspace.id !== workspaceId) notFound();
  const cases = compareRuns(before.report as unknown as PlanReport, after.report as unknown as PlanReport);
  const differing = cases.filter((c) => !c.same);
  const href = (x: string, y: string) => `/w/${workspace.id}/workflows/${workflow.id}/compare?a=${x}&b=${y}`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name, href: `/o/${org.id}` }, { label: workspace.name, href: `/w/${workspace.id}` }, { label: workflow.name, href: `/w/${workspace.id}/workflows/${workflow.id}` }, { label: 'Compare' }]}
        title={`Compare runs of ${workflow.name}`}
      >
        <Link href={href(after.id, before.id)} className="text-sm text-muted hover:underline">Swap</Link>
      </PageHeader>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 text-sm">
        {(['a', 'b'] as const).map((side) => (
          <label key={side} className="flex flex-col gap-1">
            <span className="text-xs text-muted">{side === 'a' ? 'Earlier run' : 'Later run'}</span>
            <select name={side} defaultValue={side === 'a' ? before.id : after.id} className="max-w-full rounded-md border border-line bg-panel px-2 py-1">
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{`${new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ')} UTC · ${r.status}`}</option>
              ))}
            </select>
          </label>
        ))}
        <button className="rounded-md border border-line px-3 py-1 hover:bg-bg">Compare</button>
      </form>

      <dl className="mb-8 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr_1fr]">
        <dt className="text-muted" />
        <dd className="text-xs text-muted">Earlier</dd>
        <dd className="text-xs text-muted">Later</dd>
        <dt className="text-muted">Run</dt>
        {[before, after].map((r) => (
          <dd key={r.id}>
            <Link href={`/runs/${r.id}`} className="hover:underline"><Time value={r.created_at} /></Link> <StatusBadge status={r.status} />
          </dd>
        ))}
        <dt className="text-muted">Compared</dt>
        {[before, after].map((r) => <dd key={r.id} className="font-mono text-xs break-all">{`${r.old_label} → ${r.new_label}`}</dd>)}
        <dt className="text-muted">Workflow version</dt>
        {[before, after].map((r) => <dd key={r.id} className="font-mono text-xs break-all">{r.workflow_version_id ?? 'not sent'}</dd>)}
        <dt className="text-muted">Engine</dt>
        {[before, after].map((r) => <dd key={r.id} className="font-mono text-xs break-all">{r.engine_image}</dd>)}
      </dl>

      <Section title="Cases" description={differing.length === 0 ? 'Both runs have the same result for every case.' : differing.length === cases.length ? (cases.length === 1 ? 'The only case differs.' : `All ${cases.length} cases differ.`) : `${differing.length} of ${cases.length} cases differ; the others have the same status and calls.`}>
        {differing.length === 0 ? (
          <Empty>Nothing changed between these runs.</Empty>
        ) : (
          <ul className="space-y-4">
            {differing.map((c) => (
              <li key={c.caseId} className="rounded-md border border-line bg-panel px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-medium">Case {c.caseId}</span>
                  <span className="text-muted">earlier: {c.before ? <><StatusBadge status={c.before.status} /> {numbers(c.before)}</> : 'not in this run'}</span>
                  <span className="text-muted">later: {c.after ? <><StatusBadge status={c.after.status} /> {numbers(c.after)}</> : 'not in this run'}</span>
                </div>
                {c.calls.length > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted">
                        <tr>
                          <th className="py-1 pr-4 font-medium">Call</th>
                          <th className="py-1 pr-4 font-medium">Earlier</th>
                          <th className="py-1 font-medium">Later</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {c.calls.map((k) => (
                          <tr key={k.call} className="align-top">
                            <td className="py-1 pr-4 font-mono break-all">{k.call}</td>
                            <td className="py-1 pr-4 whitespace-nowrap">{op(k.before)}</td>
                            <td className="py-1">
                              {op(k.after)}
                              {k.newFlags.map((f) => <span key={f} className="block text-diff">{f}</span>)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
