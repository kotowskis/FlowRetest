import 'server-only';
import { createAdminClient } from './supabase/admin.ts';
import { env } from './env.ts';
import { sendMail } from './mail.ts';
import { runEmail } from './notify.ts';
import type { RunSummary } from './ingest.ts';

/**
 * Emails the subscribed members of the run's organization. Runs after the upload response (next/server `after`), so a
 * slow or failing mail provider never fails or delays an upload; every attempt lands in notification_log.
 */
export async function notifyRun(runId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: recipients, error } = await admin.rpc('run_recipients', { p_run_id: runId });
  if (error) {
    console.error('[notify] run_recipients failed:', error.message);
    return;
  }
  if (!recipients || recipients.length === 0) return;
  const { data: run } = await admin.from('runs').select('id, status, mode, summary, workspace_id, workflow_id').eq('id', runId).single();
  if (!run) return;
  const [{ data: workflow }, { data: workspace }] = await Promise.all([
    admin.from('workflows').select('name').eq('id', run.workflow_id).single(),
    admin.from('workspaces').select('name').eq('id', run.workspace_id).single(),
  ]);
  for (const { email } of recipients) {
    const message = runEmail({
      to: email,
      status: run.status,
      mode: run.mode,
      workflowName: workflow?.name ?? 'workflow',
      workspaceName: workspace?.name ?? 'workspace',
      summary: run.summary as unknown as RunSummary,
      url: `${env.appUrl()}/runs/${run.id}`,
      settingsUrl: `${env.appUrl()}/w/${run.workspace_id}#notifications`,
    });
    const result = await sendMail(message);
    await admin.from('notification_log').insert({ run_id: run.id, channel: 'email', recipient: email, ok: result.ok, detail: `${result.transport}: ${result.detail ?? ''}`.slice(0, 500) });
    if (!result.ok) console.error(`[notify] ${result.transport} failed for run ${run.id}:`, result.detail);
  }
}
