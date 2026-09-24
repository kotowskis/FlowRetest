import { NextResponse, type NextRequest } from 'next/server';
import { bearerToken, hashToken } from '@/lib/tokens.ts';
import { MAX_REPORT_BYTES, prepareIngest } from '@/lib/ingest.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { env } from '@/lib/env.ts';
import type { Json } from '@/lib/database.types.ts';

export const dynamic = 'force-dynamic';

function fail(status: number, error: string, details?: string[]) {
  return NextResponse.json(details ? { error, details } : { error }, { status });
}

/**
 * `flowretest upload`: stores one redacted report for the workspace of the bearer token.
 * 201 {id, url, status}; 400 not a redacted report; 401 bad or revoked token; 413 too large; 422 values left in.
 */
export async function POST(request: NextRequest) {
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return fail(401, 'missing or malformed workspace token (Authorization: Bearer frt_...)');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_REPORT_BYTES) return fail(413, `report is ${declared} bytes, the limit is ${MAX_REPORT_BYTES}`);

  const prepared = prepareIngest(await request.text());
  if (!prepared.ok) return fail(prepared.status, prepared.error, prepared.details);
  const { row } = prepared;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('ingest_run', {
    ...row,
    p_token_hash: hashToken(token),
    p_summary: row.p_summary as unknown as Json,
    p_report: row.p_report as unknown as Json,
  });
  if (error) {
    // 28000 is raised by ingest_run for an unknown or revoked token.
    if (error.code === '28000') return fail(401, 'invalid or revoked workspace token');
    console.error('[api/runs] ingest_run failed:', error.code, error.message);
    return fail(500, 'could not store the run');
  }
  const stored = data?.[0];
  if (!stored) return fail(500, 'could not store the run');
  return NextResponse.json({ id: stored.run_id, url: `${env.appUrl()}/runs/${stored.run_id}`, status: row.p_status }, { status: 201 });
}
