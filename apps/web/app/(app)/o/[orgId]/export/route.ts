import { NextResponse } from 'next/server';
import { assertId, session } from '@/lib/data.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { exportFileName, exportLine, type ExportLine } from '@/lib/export.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Runs per request while streaming; a report is up to 5 MB, so a page stays under a few dozen megabytes. */
const RUN_PAGE = 20;

/**
 * "Download export" on the Data page: every row the service keeps for the organization, as JSON Lines, streamed so
 * a year of runs does not have to fit in memory. Owners only. Reads go through RLS like the pages; only the
 * notification log, which no member can read, comes through the service role, limited to the runs already read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  assertId(orgId);
  const { db, user } = await session();
  const { data: org } = await db.from('organizations').select('*').eq('id', orgId).maybeSingle();
  const { data: owner } = await db.rpc('is_owner', { org: orgId });
  if (!org) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (owner !== true) return NextResponse.json({ error: 'only owners can export the organization' }, { status: 403 });

  const { data: workspaces, error: wsError } = await db.from('workspaces').select('*').eq('organization_id', orgId).order('created_at');
  if (wsError) return NextResponse.json({ error: 'could not read the workspaces' }, { status: 500 });
  const wsIds = (workspaces ?? []).map((w) => w.id);
  const admin = createAdminClient();

  async function* lines(): AsyncGenerator<ExportLine> {
    yield { type: 'export', data: { format: 1, organization_id: orgId, exported_at: new Date().toISOString(), exported_by: user.email ?? user.id } };
    yield { type: 'organization', data: org };
    const orgTables = [
      ['member', db.from('members').select('*').eq('organization_id', orgId).order('created_at')],
      ['invitation', db.from('invitations').select('*').eq('organization_id', orgId).order('created_at')],
      ['dpa_acceptance', db.from('dpa_acceptances').select('*').eq('organization_id', orgId).order('accepted_at')],
      ['billing_account', db.from('billing_accounts').select('organization_id, plan, status, billing_interval, current_period_end, cancel_at_period_end, cancel_at, ended_at, updated_at').eq('organization_id', orgId)],
      ['invoice', db.from('invoices').select('*').eq('organization_id', orgId).order('created_at')],
    ] as const;
    for (const [type, query] of orgTables) yield* rows(type, await query);
    for (const w of workspaces ?? []) yield { type: 'workspace', data: w };
    if (wsIds.length === 0) return;
    const wsTables = [
      ['workspace_token', db.from('workspace_tokens').select('id, workspace_id, name, token_prefix, created_by, created_at, last_used_at, revoked_at').in('workspace_id', wsIds).order('created_at')],
      ['workflow', db.from('workflows').select('*').in('workspace_id', wsIds).order('created_at')],
      ['acceptance', db.from('acceptances').select('*').in('workspace_id', wsIds).order('created_at')],
      ['github_installation', db.from('github_installations').select('*').in('workspace_id', wsIds).order('created_at')],
      ['slack_webhook', db.from('slack_webhooks').select('id, workspace_id, url_hint, statuses, created_by, created_at').in('workspace_id', wsIds).order('created_at')],
      ['notification_subscription', db.from('notification_subscriptions').select('*').in('workspace_id', wsIds)],
    ] as const;
    for (const [type, query] of wsTables) yield* rows(type, await query);

    // Keyset pages by id: stable while the nightly purge or an owner deletes runs during the download.
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const page = await db.from('runs').select('*').in('workspace_id', wsIds).gt('id', after).order('id').limit(RUN_PAGE);
      if (page.error) throw new Error(`runs: ${page.error.message}`);
      const runs = page.data ?? [];
      if (runs.length === 0) return;
      const ids = runs.map((r) => r.id);
      const [checks, sent] = await Promise.all([
        db.from('github_checks').select('*').in('run_id', ids),
        admin.from('notification_log').select('*').in('run_id', ids),
      ]);
      for (const r of runs) yield { type: 'run', data: r };
      yield* rows('github_check', checks);
      yield* rows('notification', sent);
      after = ids[ids.length - 1] as string;
      if (runs.length < RUN_PAGE) return;
    }
  }

  const iterator = lines();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(exportLine(next.value)));
      } catch (error) {
        // Headers are gone by now; a last line tells the reader the file is incomplete instead of ending silently.
        console.error('[export] failed:', error);
        controller.enqueue(encoder.encode(exportLine({ type: 'error', data: { message: 'export stopped before the end; download it again' } })));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFileName(org.name, new Date())}"`,
      'cache-control': 'private, no-store',
    },
  });
}

function* rows(type: string, result: { data: unknown[] | null; error: { message: string } | null }): Generator<ExportLine> {
  if (result.error) throw new Error(`${type}: ${result.error.message}`);
  for (const data of result.data ?? []) yield { type, data };
}
