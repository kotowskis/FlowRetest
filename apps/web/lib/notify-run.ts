import 'server-only';
import { renderFormat, type PlanReport } from '@flowretest/core';
import { createAdminClient } from './supabase/admin.ts';
import { env } from './env.ts';
import { sendMail } from './mail.ts';
import { runEmail } from './notify.ts';
import { sendSlack, slackMessage } from './slack.ts';
import { checkConclusion, checkSummary, createCheckRun, githubConfig } from './github.ts';
import type { RunSummary } from './ingest.ts';

type Admin = ReturnType<typeof createAdminClient>;

interface RunRow {
  id: string;
  status: string;
  mode: string;
  summary: unknown;
  workspace_id: string;
  workflow_id: string;
  git_repository: string | null;
  git_sha: string | null;
  report: unknown;
}

/**
 * Everything that follows an upload: emails and Slack messages to the workspace's subscribers and a GitHub check on
 * the tested commit. Runs after the upload response (next/server `after`), so a slow or failing provider never fails
 * or delays an upload; every attempt is logged (notification_log, github_checks).
 */
export async function notifyRun(runId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: run } = await admin.from('runs').select('id, status, mode, summary, workspace_id, workflow_id, git_repository, git_sha, report').eq('id', runId).single();
  if (!run) return;
  const [{ data: workflow }, { data: workspace }] = await Promise.all([
    admin.from('workflows').select('name').eq('id', run.workflow_id).single(),
    admin.from('workspaces').select('name, organization_id').eq('id', run.workspace_id).single(),
  ]);
  const names = { workflowName: workflow?.name ?? 'workflow', workspaceName: workspace?.name ?? 'workspace' };
  // GitHub checks and Slack come with the paid plans; emails to members come with every plan.
  const { data: plan } = workspace ? await admin.rpc('org_plan', { org: workspace.organization_id }) : { data: null };
  const integrations = plan?.[0]?.integrations === true ? true : `the ${plan?.[0]?.plan ?? 'free'} plan has no GitHub checks or Slack messages`;
  await Promise.all([emails(admin, run, names), slack(admin, run, names, integrations), githubCheck(admin, run, names.workflowName, integrations)]);
}

function base(run: RunRow, names: { workflowName: string; workspaceName: string }) {
  return { status: run.status, mode: run.mode, ...names, summary: run.summary as RunSummary, url: `${env.appUrl()}/runs/${run.id}` };
}

async function emails(admin: Admin, run: RunRow, names: { workflowName: string; workspaceName: string }): Promise<void> {
  const { data: recipients, error } = await admin.rpc('run_recipients', { p_run_id: run.id });
  if (error) return console.error('[notify] run_recipients failed:', error.message);
  for (const { email } of recipients ?? []) {
    const result = await sendMail(runEmail({ ...base(run, names), to: email, settingsUrl: `${env.appUrl()}/w/${run.workspace_id}#notifications` }));
    await admin.from('notification_log').insert({ run_id: run.id, channel: 'email', recipient: email, ok: result.ok, detail: `${result.transport}: ${result.detail ?? ''}`.slice(0, 500) });
    if (!result.ok) console.error(`[notify] ${result.transport} failed for run ${run.id}:`, result.detail);
  }
}

async function slack(admin: Admin, run: RunRow, names: { workflowName: string; workspaceName: string }, integrations: true | string): Promise<void> {
  const { data: hooks } = await admin.from('slack_webhooks').select('url, url_hint, statuses').eq('workspace_id', run.workspace_id);
  for (const hook of (hooks ?? []).filter((h) => h.statuses.includes(run.status))) {
    if (integrations !== true) {
      await admin.from('notification_log').insert({ run_id: run.id, channel: 'slack', recipient: hook.url_hint, ok: false, detail: `not sent: ${integrations}` });
      continue;
    }
    const result = await sendSlack(hook.url, slackMessage(base(run, names)));
    // The hint, never the URL: the log is for support, and the URL is a credential.
    await admin.from('notification_log').insert({ run_id: run.id, channel: 'slack', recipient: hook.url_hint, ok: result.ok, detail: result.detail.slice(0, 500) });
  }
}

async function githubCheck(admin: Admin, run: RunRow, workflowName: string, integrations: true | string): Promise<void> {
  const config = githubConfig();
  if (!config || !run.git_repository || !run.git_sha) return;
  if (integrations !== true) {
    await admin.from('github_checks').insert({ run_id: run.id, workspace_id: run.workspace_id, ok: false, detail: `not posted: ${integrations}` });
    return;
  }
  const owner = run.git_repository.split('/')[0]?.toLowerCase();
  const { data: installations } = await admin.from('github_installations').select('installation_id, account_login, repositories').eq('workspace_id', run.workspace_id).is('suspended_at', null);
  const installation = (installations ?? []).find((i) => i.account_login.toLowerCase() === owner);
  const log = (row: { ok: boolean; detail?: string; installation_id?: number; check_run_id?: number; html_url?: string; conclusion?: string }) =>
    admin.from('github_checks').insert({ run_id: run.id, workspace_id: run.workspace_id, ...row, detail: row.detail?.slice(0, 500) });
  if (!installation) {
    await log({ ok: false, detail: `no GitHub App installation for ${owner} is linked to this workspace` });
    return;
  }
  // The repository comes from the uploaded report, so the token holder chooses it; only repositories whose admin
  // linked the installation get checks.
  if (!installation.repositories.includes(run.git_repository.toLowerCase())) {
    await log({ ok: false, installation_id: installation.installation_id, detail: `${run.git_repository} is not among the repositories linked by one of their admins; an admin of it can connect GitHub again` });
    return;
  }
  const report = run.report as PlanReport;
  const summary = run.summary as RunSummary;
  const counts = [summary.changed && `${summary.changed} changed`, summary.added && `${summary.added} added`, summary.removed && `${summary.removed} removed`].filter(Boolean).join(', ');
  const conclusion = checkConclusion(run.status);
  const url = `${env.appUrl()}/runs/${run.id}`;
  try {
    const check = await createCheckRun(config, installation.installation_id, {
      repository: run.git_repository,
      sha: run.git_sha,
      name: `FlowRetest · ${workflowName}`.slice(0, 100),
      conclusion,
      detailsUrl: url,
      externalId: run.id,
      title: `${run.status}: ${summary.cases} case${summary.cases === 1 ? '' : 's'}${counts ? `, ${counts}` : ''}`,
      summary: checkSummary(renderFormat(report, 'md'), url),
    });
    await log({ ok: true, installation_id: installation.installation_id, check_run_id: check.id, html_url: check.html_url, conclusion });
  } catch (e) {
    await log({ ok: false, installation_id: installation.installation_id, conclusion, detail: e instanceof Error ? e.message : String(e) });
  }
}
