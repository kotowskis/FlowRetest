import { after, NextResponse, type NextRequest } from 'next/server';
import { discardBody, fail, isTokenError, readLimited, tokenHashOf } from '@/lib/api-auth.ts';
import { MAX_REPORT_BYTES, prepareIngest } from '@/lib/ingest.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { env } from '@/lib/env.ts';
import { notifyRun } from '@/lib/notify-run.ts';
import { planLimitOf } from '@/lib/limits.ts';
import type { Json } from '@/lib/database.types.ts';

export const dynamic = 'force-dynamic';

/**
 * `flowretest upload`: stores one redacted report for the workspace of the bearer token.
 * 201 {id, url, status}; 400 not a redacted report; 401 bad or revoked token; 402 workspace beyond the plan's limit;
 * 413 too large; 422 values left in; 429 the plan's uploads per 24 hours used up.
 */
export async function POST(request: NextRequest) {
  const auth = tokenHashOf(request);
  if ('response' in auth) {
    await discardBody(request, MAX_REPORT_BYTES);
    return auth.response;
  }
  const admin = createAdminClient();
  // The token first: without a live one nobody gets the server to parse and validate a body; it is only drained.
  const known = await admin.rpc('token_workspace', { p_token_hash: auth.hash });
  if (isTokenError(known.error)) {
    await discardBody(request, MAX_REPORT_BYTES);
    return fail(401, 'invalid or revoked workspace token');
  }
  const body = await readLimited(request, MAX_REPORT_BYTES);
  if ('tooLarge' in body) return fail(413, `report is over ${MAX_REPORT_BYTES} bytes (${body.tooLarge} read)`);

  const prepared = prepareIngest(body.text);
  if (!prepared.ok) return fail(prepared.status, prepared.error, prepared.details);
  const { row } = prepared;

  const { data, error } = await admin.rpc('ingest_run', {
    ...row,
    p_token_hash: auth.hash,
    p_summary: row.p_summary as unknown as Json,
    p_report: row.p_report as unknown as Json,
  });
  if (error) {
    if (isTokenError(error)) return fail(401, 'invalid or revoked workspace token');
    const limit = planLimitOf(error);
    if (limit === 'uploads') {
      // The window is the last 24 hours; an hour is a fair first wait for a CI retry.
      const res = fail(429, `${error.message}; an owner can change the plan on the Billing page of the organization`);
      res.headers.set('retry-after', '3600');
      return res;
    }
    if (limit) return fail(402, `${error.message}; an owner can change the plan on the Billing page of the organization`);
    console.error('[api/runs] ingest_run failed:', error.code, error.message);
    return fail(500, 'could not store the run');
  }
  const stored = data?.[0];
  if (!stored) return fail(500, 'could not store the run');
  after(() => notifyRun(stored.run_id));
  return NextResponse.json({ id: stored.run_id, url: `${env.appUrl()}/runs/${stored.run_id}`, status: row.p_status }, { status: 201 });
}
