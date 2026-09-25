import Link from 'next/link';
import type { DriftCell } from '@/lib/data.ts';
import { compareEngineTags, engineTag, latestPerTag } from '@/lib/plans.ts';
import { Empty, StatusBadge, Time } from './ui.tsx';

const WORST: Record<string, number> = { ERROR: 0, BLOCKED: 1, DIFF: 2, PASS: 3 };
const TONE: Record<string, string> = { ERROR: 'text-error', BLOCKED: 'text-blocked', DIFF: 'text-diff', PASS: 'text-pass' };

/** Target engines as columns, newest first; the key is the tag, so two registries of the same version share a column. */
export function targetTags(cells: DriftCell[]): string[] {
  return [...new Set(cells.map((c) => engineTag(c.engine_to)))].sort(compareEngineTags);
}

export function DriftLocked({ plan, billingHref }: { plan: string; billingHref: string }) {
  return (
    <Empty>
      The drift matrix shows, for every workflow and n8n version, what the last <code className="font-mono">upgrade-check</code> found. It comes with the Agency plan; this organization is on {plan}.{' '}
      <Link href={billingHref} className="underline">Plans</Link>
    </Empty>
  );
}

export function DriftHowTo() {
  return (
    <Empty>
      No upgrade checks uploaded yet. Run one per workflow and target version, for example{' '}
      <code className="font-mono">npx flowretest upgrade-check --workflow &lt;id&gt; --engine-old 2.40.5 --engine-new next --upload</code>, and it appears here.
    </Empty>
  );
}

/** Rows are workflows of one workspace; a cell is the latest upgrade-check to that version, linked to its run. */
export function WorkflowDriftTable({ cells: all, workflows }: { cells: DriftCell[]; workflows: Array<{ id: string; name: string; n8n_workflow_id: string }> }) {
  const cells = latestPerTag(all);
  const tags = targetTags(cells);
  const byKey = new Map(cells.map((c) => [`${c.workflow_id} ${engineTag(c.engine_to)}`, c]));
  const rows = workflows.filter((w) => cells.some((c) => c.workflow_id === w.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Workflow</th>
            {tags.map((t) => <th key={t} className="px-4 py-2 font-mono font-medium">{`n8n ${t}`}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((w) => (
            <tr key={w.id} className="align-top">
              <td className="px-4 py-2">
                <span className="font-medium">{w.name}</span>
                <span className="block font-mono text-xs text-muted">{w.n8n_workflow_id}</span>
              </td>
              {tags.map((t) => {
                const c = byKey.get(`${w.id} ${t}`);
                return (
                  <td key={t} className="px-4 py-2">
                    {c ? (
                      <Link href={`/runs/${c.id}`} className="group block">
                        <StatusBadge status={c.status} />
                        <span className="mt-1 block text-xs text-muted group-hover:underline">from {engineTag(c.engine_from)} · <Time value={c.created_at} /></span>
                      </Link>
                    ) : (
                      <span className="text-xs text-muted">not checked</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rows are workspaces; a cell counts the latest checks of their workflows by status, coloured by the worst one. */
export function WorkspaceDriftTable({ cells: all, workspaces }: { cells: DriftCell[]; workspaces: Array<{ id: string; name: string; engine_tag: string | null }> }) {
  const cells = latestPerTag(all);
  const tags = targetTags(cells);
  const rows = workspaces.filter((w) => cells.some((c) => c.workspace_id === w.id));
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Workspace</th>
            {tags.map((t) => <th key={t} className="px-4 py-2 font-mono font-medium">{`n8n ${t}`}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((w) => (
            <tr key={w.id} className="align-top">
              <td className="px-4 py-2">
                <Link href={`/w/${w.id}/drift`} className="font-medium hover:underline">{w.name}</Link>
                {w.engine_tag ? <span className="block font-mono text-xs text-muted">runs n8n {w.engine_tag}</span> : null}
              </td>
              {tags.map((t) => {
                const here = cells.filter((c) => c.workspace_id === w.id && engineTag(c.engine_to) === t);
                if (here.length === 0) return <td key={t} className="px-4 py-2 text-xs text-muted">not checked</td>;
                const counts = Object.entries(here.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status ?? "?"]: (acc[c.status ?? "?"] ?? 0) + 1 }), {})).sort(([a], [b]) => (WORST[a] ?? 9) - (WORST[b] ?? 9));
                const worst = counts[0]?.[0] ?? 'PASS';
                return (
                  <td key={t} className="px-4 py-2">
                    <Link href={`/w/${w.id}/drift`} className={`font-mono text-xs hover:underline ${TONE[worst] ?? ''}`}>
                      {counts.map(([s, n]) => `${n} ${s}`).join(' · ')}
                    </Link>
                    <span className="block text-xs text-muted">{here.length} workflow{here.length === 1 ? '' : 's'}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
