import type { Metadata } from 'next';
import Link from 'next/link';
import { getWorkspace } from '@/lib/data.ts';
import { env } from '@/lib/env.ts';
import { githubConfig } from '@/lib/github.ts';
import { ActionForm, ConfirmButton, TokenForm } from '@/components/forms.tsx';
import { Empty, PageHeader, Section, StatusBadge, Time, WorkspaceNav, buttonClass, inputClass, secondaryButtonClass } from '@/components/ui.tsx';
import { addSlackWebhook, createToken, deleteWorkspace, removeSlackWebhook, revokeToken, setSubscription, unlinkGitHub } from '../../actions.ts';

export const metadata: Metadata = { title: 'Workspace' };

/** Result of the GitHub install round trip, passed back as ?github=. */
const GITHUB_MESSAGES: Record<string, { text: string; ok?: boolean }> = {
  linked: { text: 'GitHub installation linked. Uploads from its repositories now get a check on the tested commit.', ok: true },
  requested: { text: 'GitHub asked an organization owner to approve the installation. Connect again once it is approved.' },
  'not-yours': { text: 'GitHub did not list that installation for your account, so it was not linked.' },
  'owner-only': { text: 'Only owners of this organization can connect GitHub.' },
  plan: { text: 'GitHub checks come with the Team and Agency plans. An owner can change the plan on the Billing page.' },
  'not-admin': { text: 'Your GitHub account is not an admin of any repository in that installation. Ask a repository admin to connect GitHub.' },
  'no-installation': { text: 'GitHub did not return an installation. Try connecting again.' },
  error: { text: 'Linking failed. Try again; if it keeps failing, check the GitHub App settings of this server.' },
};

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ github?: string }> }) {
  const { workspaceId } = await params;
  const { github } = await searchParams;
  const { workspace, org, tokens, workflows, statuses, installations, slackHooks, isOwner, overLimit, limits } = await getWorkspace(workspaceId);
  const billing = `/o/${org.id}/billing`;
  const planNote = limits.integrations ? null : (
    <p className="mb-4 text-sm text-diff">
      The Free plan sends no GitHub checks or Slack messages. <Link href={billing} className="underline">Team and Agency</Link> do.
    </p>
  );
  const githubReady = githubConfig() !== undefined;
  const githubMessage = github ? GITHUB_MESSAGES[github] : undefined;
  const subtitle = [workspace.instance_host, workspace.engine_tag && `n8n ${workspace.engine_tag}`].filter(Boolean).join(' · ');
  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name, href: `/o/${org.id}` }, { label: workspace.name }]} title={workspace.name}>
        <span className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {subtitle ? <span className="font-mono">{subtitle}</span> : null}
        </span>
      </PageHeader>
      <WorkspaceNav workspaceId={workspace.id} current="overview" />

      {overLimit ? (
        <p role="alert" className="mb-10 rounded-md border border-error/45 bg-error/10 px-4 py-3 text-sm leading-6 text-error">
          This workspace is beyond the {limits.workspaces} workspace{limits.workspaces === 1 ? '' : 's'} of the {limits.plan} plan, so uploads to it are refused. Existing runs stay readable.{' '}
          <Link href={billing} className="underline">Change the plan</Link> or delete a newer workspace.
        </p>
      ) : null}

      <Section title="Workflows" description="A workflow appears here after its first uploaded run.">
        {workflows.length === 0 ? (
          <Empty>
            No runs yet. Create a token below and run <code className="font-mono">flowretest upload --workflow &lt;id&gt;</code> after a run, or add <code className="font-mono">--upload</code> to <code className="font-mono">flowretest run</code>.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-panel">
            <table className="ledger text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Workflow</th>
                  <th className="px-4 py-2 font-medium">n8n id</th>
                  <th className="px-4 py-2 font-medium">Last run</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
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
            <button className={secondaryButtonClass}>Save</button>
          </form>
        </Section>
      </div>

      <div id="github">
        <Section title="GitHub" description="A check with the result and a link to the plan on the commit a CI run tested. To block merging on DIFF, make the check required in the branch protection rules. On a public repository the check text (node names, hosts, paths, value shapes) is public too.">
          {planNote}
          {githubMessage ? <p role="status" className={`mb-4 text-sm ${githubMessage.ok ? 'text-pass' : 'text-diff'}`}>{githubMessage.text}</p> : null}
          {!githubReady ? (
            <Empty>This server has no GitHub App configured.</Empty>
          ) : (
            <>
              {installations.length > 0 ? (
                <ul className="mb-4 record-list">
                  {installations.map((i) => (
                    <li key={i.installation_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span>
                        <span className="font-medium">{i.account_login}</span> <span className="text-xs text-muted">{i.account_type.toLowerCase()}</span>
                        {i.suspended_at ? <span className="ml-2 text-xs text-diff">suspended on GitHub</span> : null}
                        <span className="block text-xs text-muted">{i.repositories.length > 0 ? `checks on ${i.repositories.join(', ')}` : 'no repositories; connect again as a repository admin'}</span>
                      </span>
                      {isOwner ? (
                        <form action={unlinkGitHub}>
                          <input type="hidden" name="workspaceId" value={workspace.id} />
                          <input type="hidden" name="installationId" value={i.installation_id} />
                          <ConfirmButton confirm={`Unlink ${i.account_login}`}>Unlink</ConfirmButton>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {isOwner ? (
                <a href={`/api/github/install?workspace=${workspace.id}`} className={buttonClass}>
                  {installations.length ? 'Connect another GitHub account' : 'Connect GitHub'}
                </a>
              ) : installations.length === 0 ? (
                <Empty>No GitHub account linked. An owner of this organization can connect one.</Empty>
              ) : null}
            </>
          )}
        </Section>
      </div>

      <Section title="Slack" description="An incoming webhook gets the status, counts and a link for runs with the chosen statuses.">
        {planNote}
        {slackHooks.length > 0 ? (
          <ul className="mb-4 record-list">
            {slackHooks.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <code className="font-mono text-xs break-all">{h.url_hint}</code>
                <span className="flex items-center gap-3 font-mono text-xs text-muted">
                  {h.statuses.join(', ')}
                  {isOwner ? (
                    <form action={removeSlackWebhook}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="webhookId" value={h.id} />
                      <ConfirmButton confirm="Remove webhook">Remove</ConfirmButton>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {isOwner ? (
          <ActionForm action={addSlackWebhook} submit="Add webhook" pending="Adding…">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm">
              Webhook URL
              <input name="url" type="url" required placeholder="https://hooks.slack.com/services/…" className={inputClass} />
            </label>
            <fieldset className="flex items-center gap-3 pb-2">
              {(['DIFF', 'ERROR', 'BLOCKED', 'PASS'] as const).map((s) => (
                <label key={s} className="flex items-center gap-1 font-mono text-xs">
                  <input type="checkbox" name="status" value={s} defaultChecked={s === 'DIFF' || s === 'ERROR'} />
                  {s}
                </label>
              ))}
            </fieldset>
          </ActionForm>
        ) : slackHooks.length === 0 ? (
          <Empty>No Slack webhook. An owner of this organization can add one.</Empty>
        ) : null}
      </Section>

      <Section title="Tokens" description="FLOWRETEST_TOKEN for this workspace. The CLI sends only the redacted report; fixtures and the full report stay on the machine that ran it.">
        <TokenForm action={createToken} workspaceId={workspace.id} appUrl={env.appUrl()} />
        {tokens.length > 0 ? (
          <ul className="mt-6 record-list">
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
                      <ConfirmButton confirm={`Revoke ${t.name}`}>Revoke</ConfirmButton>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {isOwner ? (
        <Section title="Delete the workspace" description="Deletes its tokens, workflows, runs and acceptances at once. Runners with its token get 401 from then on; baselines on their machines stay.">
          <ActionForm action={deleteWorkspace} submit="Delete workspace" pending="Deleting…">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span>Type <span className="font-mono">{workspace.name}</span> to confirm</span>
              <input name="confirm" required autoComplete="off" className={inputClass} />
            </label>
          </ActionForm>
        </Section>
      ) : null}
    </>
  );
}
