import type { Metadata } from 'next';
import Link from 'next/link';
import { getWorkspace } from '@/lib/data.ts';
import { env } from '@/lib/env.ts';
import { TokenForm } from '@/components/forms.tsx';
import { Empty, PageHeader, Section, StatusBadge, Time, buttonClass, quietButtonClass } from '@/components/ui.tsx';
import { createToken, revokeToken, setSubscription } from '../../actions.ts';

export const metadata: Metadata = { title: 'Workspace' };

export default async function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { workspace, org, tokens, workflows, statuses } = await getWorkspace(workspaceId);
  const subtitle = [workspace.instance_host, workspace.engine_tag && `n8n ${workspace.engine_tag}`].filter(Boolean).join(' · ');
  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name, href: `/o/${org.id}` }, { label: workspace.name }]} title={workspace.name}>
        {subtitle ? <span className="font-mono text-sm text-muted">{subtitle}</span> : null}
      </PageHeader>

      <Section title="Workflows" description="A workflow appears here after its first uploaded run.">
        {workflows.length === 0 ? (
          <Empty>
            No runs yet. Create a token below and run <code className="font-mono">flowretest upload --workflow &lt;id&gt;</code> after a run, or add <code className="font-mono">--upload</code> to <code className="font-mono">flowretest run</code>.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-panel">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Workflow</th>
                  <th className="px-4 py-2 font-medium">n8n id</th>
                  <th className="px-4 py-2 font-medium">Last run</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {workflows.map((w) => (
                  <tr key={w.id} className="hover:bg-bg">
                    <td className="px-4 py-2">
                      <Link href={`/w/${workspace.id}/workflows/${w.id}`} className="font-medium hover:underline">{w.name}</Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{w.n8n_workflow_id}</td>
                    <td className="px-4 py-2 text-muted"><Time value={w.last_run_at} /></td>
                    <td className="px-4 py-2"><StatusBadge status={w.last_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div id="notifications">
        <Section title="Email notifications" description="Your own address only. Each email has the status, counts and a link to the plan; no values.">
          <form action={setSubscription} className="flex flex-wrap items-center gap-4 text-sm">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <span className="text-muted">Email me about runs with status</span>
            {(['DIFF', 'ERROR', 'BLOCKED', 'PASS'] as const).map((s) => (
              <label key={s} className="flex items-center gap-1 font-mono text-xs">
                <input type="checkbox" name="status" value={s} defaultChecked={statuses.includes(s)} />
                {s}
              </label>
            ))}
            <button className={buttonClass}>Save</button>
          </form>
        </Section>
      </div>

      <Section title="Tokens" description="FLOWRETEST_TOKEN for this workspace. The CLI sends only the redacted report; fixtures and the full report stay on the machine that ran it.">
        <TokenForm action={createToken} workspaceId={workspace.id} appUrl={env.appUrl()} />
        {tokens.length > 0 ? (
          <ul className="mt-6 divide-y divide-line rounded-md border border-line bg-panel">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className={t.revoked_at ? 'text-muted line-through' : ''}>
                  {t.name} <code className="ml-2 font-mono text-xs text-muted">{t.token_prefix}…</code>
                </span>
                <span className="flex flex-wrap items-center gap-3 text-xs text-muted">
                  <span>last used <Time value={t.last_used_at} /></span>
                  {t.revoked_at ? (
                    <span>revoked <Time value={t.revoked_at} /></span>
                  ) : (
                    <form action={revokeToken}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="tokenId" value={t.id} />
                      <button className={quietButtonClass}>Revoke</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
    </>
  );
}
