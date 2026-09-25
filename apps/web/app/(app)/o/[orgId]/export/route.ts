import { NextResponse } from 'next/server';
import { assertId, session } from '@/lib/data.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { chunks, exportFileName, exportLine, type ExportLine } from '@/lib/export.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Runs per request while streaming. A report is up to 5 MB and the page is held twice (the response and the parsed
 * rows), so five runs keep one page near 50 MB (audit of week 14, item 25: twenty took the process up by 300 MB).
 */
const RUN_PAGE = 5;
/** Rows per request for every other table; PostgREST answers at most 1000 (max_rows) without an error. */
const ROW_PAGE = 1000;
/** Workspace ids per `in` filter: each is 37 characters of the URL, and about 250 of them made it too long. */
const WORKSPACE_CHUNK = 100;
/** Stop with an error line before the platform ends the function at maxDuration. */
const TIME_BUDGET_MS = 270_000;

type Page = { data: unknown[] | null; error: { message: string } | null };

/**
 * "Download export" on the Data page: every row the service keeps for the organization, as JSON Lines, streamed so
 * a year of runs does not have to fit in memory. Owners only. Reads go through RLS like the pages; the rows no member
 * can read (the notification log, upload counter, sub-processor emails, trial and plan-change dates) come through the
 * service role, limited to this organization. Every table is read in pages, and the last line says how many lines
 * came before it, so a file cut short by a timeout or a crash is visible.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  assertId(orgId);
  const { db, user } = await session();
  const { data: org } = await db.from('organizations').select('*').eq('id', orgId).maybeSingle();
  const { data: owner } = await db.rpc('is_owner', { org: orgId });
  if (!org) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (owner !== true) return NextResponse.json({ error: 'only owners can export the organization' }, { status: 403 });

  const admin = createAdminClient();
  const started = Date.now();

  /** Rows of one query in pages of ROW_PAGE; `order` must make the order stable. */
  async function* paged(type: string, page: (from: number, to: number) => PromiseLike<Page>): AsyncGenerator<ExportLine> {
    for (let from = 0; ; from += ROW_PAGE) {
      const result = await page(from, from + ROW_PAGE - 1);
      yield* rows(type, result);
      if ((result.data ?? []).length < ROW_PAGE) return;
    }
  }

  async function* lines(): AsyncGenerator<ExportLine> {
    yield { type: 'export', data: { format: 2, organization_id: orgId, exported_at: new Date().toISOString(), exported_by: user.email ?? user.id } };
    yield { type: 'organization', data: org };
    yield* paged('member', (f, t) => db.from('members').select('*').eq('organization_id', orgId).order('created_at').order('user_id').range(f, t));
    yield* paged('invitation', (f, t) => db.from('invitations').select('*').eq('organization_id', orgId).order('created_at').order('id').range(f, t));
    yield* paged('dpa_acceptance', (f, t) => db.from('dpa_acceptances').select('*').eq('organization_id', orgId).order('accepted_at').order('id').range(f, t));
    // Without the Stripe ids: they are keys to the payment account, not the organization's data.
    yield* rows('billing_account', await admin.from('billing_accounts').select('organization_id, plan, status, billing_interval, current_period_end, cancel_at_period_end, cancel_at, ended_at, trial_end, first_subscription_at, previous_plan, plan_changed_at, updated_at').eq('organization_id', orgId));
    yield* paged('invoice', (f, t) => db.from('invoices').select('*').eq('organization_id', orgId).order('created_at').order('id').range(f, t));
    yield* paged('upload_event', (f, t) => admin.from('upload_events').select('*').eq('organization_id', orgId).order('at').order('id').range(f, t));
    yield* paged('subprocessor_notice_email', (f, t) => admin.from('subprocessor_notice_deliveries').select('*').contains('organization_ids', [orgId]).order('sent_at').order('email').range(f, t));

    const workspaceIds: string[] = [];
    for await (const line of paged('workspace', (f, t) => db.from('workspaces').select('*').eq('organization_id', orgId).order('created_at').order('id').range(f, t))) {
      workspaceIds.push((line.data as { id: string }).id);
      yield line;
    }
    for (const ids of chunks(workspaceIds, WORKSPACE_CHUNK)) {
      yield* paged('workspace_token', (f, t) => db.from('workspace_tokens').select('id, workspace_id, name, token_prefix, created_by, created_at, last_used_at, revoked_at').in('workspace_id', ids).order('created_at').order('id').range(f, t));
      yield* paged('workflow', (f, t) => db.from('workflows').select('*').in('workspace_id', ids).order('created_at').order('id').range(f, t));
      yield* paged('acceptance', (f, t) => db.from('acceptances').select('*').in('workspace_id', ids).order('created_at').order('id').range(f, t));
      yield* paged('github_installation', (f, t) => db.from('github_installations').select('*').in('workspace_id', ids).order('created_at').order('installation_id').order('workspace_id').range(f, t));
      yield* paged('slack_webhook', (f, t) => db.from('slack_webhooks').select('id, workspace_id, url_hint, statuses, created_by, created_at').in('workspace_id', ids).order('created_at').order('id').range(f, t));
      yield* paged('notification_subscription', (f, t) => db.from('notification_subscriptions').select('*').in('workspace_id', ids).order('workspace_id').order('user_id').range(f, t));
    }

    // Keyset pages by id: stable while the nightly purge or an owner deletes runs during the download.
    for (const ids of chunks(workspaceIds, WORKSPACE_CHUNK)) {
      let after = '00000000-0000-0000-0000-000000000000';
      for (;;) {
        if (Date.now() - started > TIME_BUDGET_MS) throw new ExportTooLong();
        const page = await db.from('runs').select('*').in('workspace_id', ids).gt('id', after).order('id').limit(RUN_PAGE);
        if (page.error) throw new Error(`runs: ${page.error.message}`);
        const runs = page.data ?? [];
        if (runs.length === 0) break;
        const runIds = runs.map((r) => r.id);
        for (const r of runs) yield { type: 'run', data: r };
        yield* paged('github_check', (f, t) => db.from('github_checks').select('*').in('run_id', runIds).order('id').range(f, t));
        yield* paged('notification', (f, t) => admin.from('notification_log').select('*').in('run_id', runIds).order('id').range(f, t));
        after = runIds[runIds.length - 1] as string;
        if (runs.length < RUN_PAGE) break;
      }
    }
  }

  const iterator = lines();
  const encoder = new TextEncoder();
  let count = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          // The reader checks that the file ends with this line and that the count matches.
          controller.enqueue(encoder.encode(exportLine({ type: 'end', data: { lines: count } })));
          controller.close();
          return;
        }
        count += 1;
        controller.enqueue(encoder.encode(exportLine(next.value)));
      } catch (error) {
        // Headers are gone by now; a last line tells the reader the file is incomplete instead of ending silently.
        console.error('[export] failed:', error);
        const message = error instanceof ExportTooLong ? `the export is larger than one download can carry in ${maxDuration} seconds; write to us for a full copy` : 'export stopped before the end; download it again';
        controller.enqueue(encoder.encode(exportLine({ type: 'error', data: { message, lines: count } })));
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

class ExportTooLong extends Error {}

function* rows(type: string, result: Page): Generator<ExportLine> {
  if (result.error) throw new Error(`${type}: ${result.error.message}`);
  for (const data of result.data ?? []) yield { type, data };
}
